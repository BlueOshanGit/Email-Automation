const express = require("express");
const router = express.Router();
const axios = require("axios");
const mongoose = require("mongoose");
require("dotenv").config();

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE_URL = process.env.BASE_URL;
const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "5686032";

// Timezone offset for email scheduling (in minutes ahead of UTC)
// IST = 330 (UTC+5:30), EST = -300 (UTC-5), UTC = 0
// Set SCHEDULE_TZ_OFFSET in .env to override (defaults to server's local timezone)
const SCHEDULE_TZ_OFFSET = parseInt(process.env.SCHEDULE_TZ_OFFSET || String(-(new Date().getTimezoneOffset())));
console.log(`📍 Scheduling timezone offset: UTC${SCHEDULE_TZ_OFFSET >= 0 ? '+' : ''}${Math.floor(SCHEDULE_TZ_OFFSET/60)}:${String(Math.abs(SCHEDULE_TZ_OFFSET%60)).padStart(2,'0')}`);

// Import your ClonedEmail model
const ClonedEmail = require("../models/clonedEmail");

// Authentication middleware
function ensureAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

const processedEmailsCache = new Set();

// Batch check multiple emails at once for better performance
async function batchCheckEmailsExist(emailNames) {
  if (emailNames.length === 0) return {};

  try {
    console.log(`Batch checking ${emailNames.length} emails for existence`);

    // Create a map to store results
    const existsMap = {};

    // Initialize all as not existing
    emailNames.forEach(name => existsMap[name] = false);

    // Check each email individually but with reduced delays (still more efficient than original)
    // HubSpot's search API is complex for exact name matching, so individual checks are more reliable
    for (let i = 0; i < emailNames.length; i += 5) {
      const batch = emailNames.slice(i, i + 5);

      const batchPromises = batch.map(async (emailName) => {
        try {
          const response = await axios.get(`${BASE_URL}`, {
            params: {
              name: emailName,
              limit: 1,
            },
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          });

          const exists = response.data.total > 0 || (response.data.results && response.data.results.length > 0);
          return { emailName, exists };
        } catch (error) {
          console.error(`Error checking ${emailName}:`, error.message);
          return { emailName, exists: false };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(result => {
        existsMap[result.emailName] = result.exists;
      });

      // Small delay between batches
      if (i + 5 < emailNames.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const existingCount = Object.values(existsMap).filter(exists => exists).length;
    console.log(`Batch check completed. Found ${existingCount} existing emails out of ${emailNames.length}`);
    return existsMap;
  } catch (error) {
    console.error('Error in batch email check:', error.response?.data || error.message);
    // Return empty map on error to allow cloning attempts
    const existsMap = {};
    emailNames.forEach(name => existsMap[name] = false);
    return existsMap;
  }
}

async function EmailCloner(emailIds, cloningCount, strategy = "smart", customOptions = {}) {
  try {
    let stats = {
      totalAttempted: 0,
      successfullyCloned: 0,
      duplicatesSkipped: 0,
      errors: 0,
      clonedEmails: [],
    };

    console.log('🚀 Starting optimized batch processing...');

    // First, get all email names in batch
    console.log('📥 Fetching email information...');
    const emailInfoMap = new Map();

    for (const emailId of emailIds) {
      try {
        const response = await axios.get(`${BASE_URL}/${emailId}`, {
          headers: {
            Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          params: {
            properties: "name"
          }
        });
        emailInfoMap.set(emailId, response.data.name);
      } catch (error) {
        console.error(`Error getting email info for ${emailId}:`, error.message);
        stats.errors++;
      }
    }

    // Generate all email names and schedules
    const emailNamesToCheck = [];
    const emailScheduleMap = new Map();

    for (let day = 1; day <= cloningCount; day++) {
      let morningMinuteCounter = 0;
      let afternoonMinuteCounter = 0;
      let customTimeCounter = 0;
      let emailIndex = 0;
      const MAX_MORNING_SLOTS = 12;

      for (let i = 0; i < emailIds.length; i++) {
        const emailId = emailIds[i];
        const originalEmailName = emailInfoMap.get(emailId);

        if (!originalEmailName) {
          stats.errors++;
          continue;
        }

        let hour, minute;

        // Calculate timing (same logic as before)
        switch (strategy) {
          case "morning":
            hour = 11;
            minute = morningMinuteCounter;
            morningMinuteCounter += 5;
            if (minute >= 60) {
              hour += Math.floor(minute / 60);
              minute = minute % 60;
            }
            break;

          case "afternoon":
            hour = 16;
            minute = afternoonMinuteCounter;
            afternoonMinuteCounter += 5;
            if (minute >= 60) {
              hour += Math.floor(minute / 60);
              minute = minute % 60;
            }
            break;

          case "custom":
            const startHour = customOptions.customStartHour || 11;
            const startMinute = customOptions.customStartMinute || 0;
            const interval = customOptions.customInterval || 5;

            const startTotalMinutes = startHour * 60 + startMinute;
            const scheduledTotalMinutes = startTotalMinutes + (customTimeCounter * interval);

            hour = Math.floor(scheduledTotalMinutes / 60);
            minute = scheduledTotalMinutes % 60;

            // Cap at end of day to prevent date rollover
            if (hour >= 24) {
              hour = 23;
              minute = 55;
            }

            customTimeCounter++;
            break;

          case "smart":
          default:
            if (emailIndex < MAX_MORNING_SLOTS) {
              hour = 11;
              minute = morningMinuteCounter;
              morningMinuteCounter += 5;
            } else {
              hour = 16;
              minute = afternoonMinuteCounter;
              afternoonMinuteCounter += 5;
            }

            if (minute >= 60) {
              hour += Math.floor(minute / 60);
              minute = minute % 60;
            }
            emailIndex++;
            break;
        }

        // Generate the expected email name
        const datePattern = /\d{2} \w{3} \d{4}/;
        const dateMatch = originalEmailName.match(datePattern);

        if (dateMatch) {
          // Manually parse date to avoid timezone issues with new Date(string)
          const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
          const dateParts = dateMatch[0].split(' ');
          const parsedDay = parseInt(dateParts[0], 10);
          const parsedMonth = monthMap[dateParts[1]];
          const parsedYear = parseInt(dateParts[2], 10);

          // Create email name date (just for calendar rollover, timezone doesn't matter)
          const nameDate = new Date(parsedYear, parsedMonth, parsedDay + day);
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const updatedDate = `${nameDate.getDate().toString().padStart(2, '0')} ${monthNames[nameDate.getMonth()]} ${nameDate.getFullYear()}`;

          // Create scheduled time in UTC, adjusted for target timezone
          // hour:minute is the desired time in SCHEDULE_TZ timezone
          // Subtract offset to convert to UTC (e.g., 11:00 IST - 5:30 = 05:30 UTC)
          let clonedDate = new Date(Date.UTC(parsedYear, parsedMonth, parsedDay + day, hour, minute, 0, 0) - (SCHEDULE_TZ_OFFSET * 60 * 1000));

          const newEmailName = originalEmailName.replace(dateMatch[0], updatedDate);

          emailNamesToCheck.push(newEmailName);
          emailScheduleMap.set(newEmailName, {
            originalEmailId: emailId,
            day,
            hour,
            minute,
            scheduledTime: clonedDate,
            originalEmailName
          });
        } else {
          stats.errors++;
          console.log(`⚠️ No date pattern found in: ${originalEmailName}`);
        }

        stats.totalAttempted++;
      }
    }

    // Batch check for duplicates in MongoDB
    console.log('📊 Batch checking database duplicates...');
    const dbDuplicates = await ClonedEmail.find({
      clonedEmailName: { $in: emailNamesToCheck }
    }).select('clonedEmailName');

    const dbDuplicateNames = new Set(dbDuplicates.map(doc => doc.clonedEmailName));

    // Batch check for duplicates in HubSpot
    console.log('🔍 Batch checking HubSpot duplicates...');
    const hubspotDuplicates = await batchCheckEmailsExist(emailNamesToCheck);

    // Filter out duplicates before processing
    const emailsToProcess = emailNamesToCheck.filter(name => {
      if (processedEmailsCache.has(name) || dbDuplicateNames.has(name) || hubspotDuplicates[name]) {
        stats.duplicatesSkipped++;
        console.log(`⚠️ Skipping duplicate: ${name}`);
        return false;
      }
      processedEmailsCache.add(name);
      return true;
    });

    console.log(`✅ Processing ${emailsToProcess.length} emails (${stats.duplicatesSkipped} duplicates skipped)`);

    // Process remaining emails in parallel batches
    const BATCH_SIZE = 3; // Process 3 emails simultaneously
    for (let i = 0; i < emailsToProcess.length; i += BATCH_SIZE) {
      const batch = emailsToProcess.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (emailName) => {
        const schedule = emailScheduleMap.get(emailName);
        const result = await cloneAndScheduleEmailOptimized(
          schedule.originalEmailId,
          schedule.day,
          schedule.hour,
          schedule.minute,
          emailName,
          schedule.scheduledTime,
          strategy
        );
        return result;
      });

      const batchResults = await Promise.all(batchPromises);

      batchResults.forEach(result => {
        if (result.success) {
          stats.successfullyCloned++;
          stats.clonedEmails.push({
            id: result.emailId,
            name: result.emailName,
            time: result.scheduledTime,
          });
        } else {
          stats.errors++;
        }
      });

      // Small delay between batches
      if (i + BATCH_SIZE < emailsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return {
      success: true,
      message: `Email cloning completed. ${stats.successfullyCloned} cloned, ${stats.duplicatesSkipped} duplicates skipped, ${stats.errors} errors.`,
      stats: stats,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to complete cloning process: ${error.message}`,
      error: error,
    };
  }
}

// Optimized version without redundant duplicate checking
async function cloneAndScheduleEmailOptimized(
  originalEmailId,
  dayOffset,
  hour,
  minute,
  newEmailName,
  scheduledTime,
  strategy = "smart"
) {
  let clonedEmail = null;
  let cloneAttempted = false;

  try {
    console.log(`🔄 Cloning: ${originalEmailId} -> "${newEmailName}"`);
    console.log(`⏰ Scheduled for: ${scheduledTime.toISOString()} (${hour}:${minute < 10 ? '0' + minute : minute})`);

    // Get original email with custom properties and lists
    const response = await axios.get(`${BASE_URL}/${originalEmailId}`, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      params: {
        properties: "name,emailCategory,mdlzBrand"
      }
    });

    const originalEmail = response.data;

    // Extract custom properties
    let emailCategory = originalEmail.emailCategory || originalEmail.properties?.emailCategory || originalEmail.properties?.["Email Category"];
    let mdlzBrand = originalEmail.mdlzBrand || originalEmail.properties?.mdlzBrand || originalEmail.properties?.["MDLZ Brand"];

    // Get the recipient configuration from the original email to copy it
    // Check which format the email uses
    const originalTo = originalEmail.to;
    const originalMailingListsIncluded = originalEmail.mailingListsIncluded;

    console.log(`📋 Original email recipient format:`);
    if (originalTo) {
      console.log(`   - Uses 'to' object format`);
      console.log(`   - ILS lists include: ${JSON.stringify(originalTo.contactIlsLists?.include || [])}`);
      console.log(`   - Contact lists include: ${JSON.stringify(originalTo.contactLists?.include || [])}`);
    }
    if (originalMailingListsIncluded) {
      console.log(`   - Uses 'mailingListsIncluded' format: ${JSON.stringify(originalMailingListsIncluded)}`);
    }

    // Clone the email using correct v3 API endpoint
    // Ensure ID is a string as required by HubSpot API
    console.log(`📤 Cloning API Request: POST ${BASE_URL}/clone`);
    console.log(`📤 Request Body:`, JSON.stringify({ id: String(originalEmailId), cloneName: newEmailName, language: "en" }));

    cloneAttempted = true;

    try {
      const cloneResponse = await axios({
        method: 'POST',
        url: `${BASE_URL}/clone`,
        data: {
          id: String(originalEmailId),
          cloneName: newEmailName,
          language: "en"
        },
        headers: {
          'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      clonedEmail = cloneResponse.data;
    } catch (cloneError) {
      // Even if clone returns an error, check if the email was actually created
      // Some HubSpot API responses return error codes even when successful
      console.log(`⚠️ Clone request returned status ${cloneError.response?.status} - verifying...`);

      // Wait a bit for HubSpot to process
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if the email exists in HubSpot
      try {
        const verifyResponse = await axios.get(`${BASE_URL}`, {
          params: {
            name: newEmailName,
            limit: 1,
          },
          headers: {
            Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        if (verifyResponse.data.results && verifyResponse.data.results.length > 0) {
          clonedEmail = verifyResponse.data.results[0];
          console.log(`✅ Email cloned successfully! Found ID: ${clonedEmail.id}`);
          // Clear the error - email was actually created successfully
        } else {
          // Email was not cloned, throw the original error
          console.error(`❌ Clone failed - email not found in HubSpot`);
          throw cloneError;
        }
      } catch (verifyError) {
        // Verification failed, throw original clone error
        console.error(`❌ Verification failed: ${verifyError.message}`);
        throw cloneError;
      }
    }

    // Update the cloned email with recipient lists and scheduled time
    try {
      // HARDCODED LISTS - ONLY these two lists will be used (clearing all original lists)
      const SEED_LIST_ID = 39067;  // Seed list - add to "Send to" (ILS ID)
      const EXCLUSION_LIST_ID = 10469;  // Unsubscribed/bounced/opt-outs - add to "Don't send to" (ILS ID)

      // Step 1: Update DRAFT with recipient lists and custom properties
      const draftPayload = {
        to: {
          contactIlsLists: {
            include: [SEED_LIST_ID],
            exclude: [EXCLUSION_LIST_ID]
          }
        }
      };

      // Add custom properties
      if (emailCategory !== null && emailCategory !== undefined) {
        draftPayload.emailCategory = emailCategory;
      }
      if (mdlzBrand !== null && mdlzBrand !== undefined) {
        draftPayload.mdlzBrand = mdlzBrand;
      }

      console.log(`📋 Setting lists (V3 format) - Include: [${SEED_LIST_ID}], Exclude: [${EXCLUSION_LIST_ID}]`);
      const draftResponse = await axios.patch(`${BASE_URL}/${clonedEmail.id}/draft`, draftPayload, {
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
      console.log(`📝 Draft updated with recipient lists. Response status: ${draftResponse.status}`);

      // Step 2: Set publishDate with sendOnPublish:false
      // HubSpot API limitation: sendOnPublish:true ALWAYS clears publishDate
      // So we store the date with sendOnPublish:false (confirmed working)
      const publishDateISO = scheduledTime.toISOString();
      console.log(`📅 Step 2: Setting publishDate=${publishDateISO} (sendOnPublish=false)...`);
      const scheduleResponse = await axios.patch(`${BASE_URL}/${clonedEmail.id}`, {
        sendOnPublish: false,
        publishDate: publishDateISO
      }, {
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });
      console.log(`✅ HubSpot publishDate set: ${scheduleResponse.data?.publishDate}`);
    } catch (updateError) {
      console.error(`⚠️ Update error (email still cloned): ${updateError.response?.status} - ${updateError.message}`);
      if (updateError.response?.data) {
        console.error(`   Error details:`, JSON.stringify(updateError.response.data));
      }
      // Continue despite update error - the email was still cloned
    }

    // Save to MongoDB
    try {
      const clonedEmailRecord = new ClonedEmail({
        originalEmailId: originalEmailId,
        clonedEmailId: clonedEmail.id,
        clonedEmailName: newEmailName,
        scheduledTime: scheduledTime,
        cloningStrategy: strategy,
      });
      await clonedEmailRecord.save();
    } catch (saveError) {
      console.error(`⚠️ MongoDB save error: ${saveError.message}`);
    }

    console.log(`✅ Successfully cloned: "${newEmailName}" (ID: ${clonedEmail.id}) [DRAFT]`);

    return {
      success: true,
      emailId: clonedEmail.id,
      emailName: newEmailName,
      scheduledTime: scheduledTime.toISOString(),
    };
  } catch (error) {
    console.error(`❌ Error cloning email ${originalEmailId}:`, error.response?.status || error.message);
    return {
      success: false,
      error: error.message,
      details: error.response?.data,
    };
  }
}

router.post("/clone-emails", ensureAuthenticated, async (req, res) => {
  const { emailIds, cloningCount, strategy = "smart", customStartHour, customStartMinute, customInterval } = req.body;

  // input validation
  if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please provide at least one valid email ID",
    });
  }

  if (!cloningCount || isNaN(cloningCount)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid cloning count",
    });
  }

  // Custom time validation
  if (strategy === "custom") {
    if (customStartHour !== undefined && (isNaN(customStartHour) || customStartHour < 0 || customStartHour > 23)) {
      return res.status(400).json({
        success: false,
        message: "Custom start hour must be between 0 and 23",
      });
    }

    if (customStartMinute !== undefined && (isNaN(customStartMinute) || customStartMinute < 0 || customStartMinute > 59)) {
      return res.status(400).json({
        success: false,
        message: "Custom start minute must be between 0 and 59",
      });
    }

    if (customInterval !== undefined && (isNaN(customInterval) || customInterval < 1 || customInterval > 60)) {
      return res.status(400).json({
        success: false,
        message: "Custom interval must be between 1 and 60 minutes",
      });
    }
  }

  try {
    processedEmailsCache.clear();

    // Build custom options object
    const customOptions = {};
    if (strategy === "custom") {
      customOptions.customStartHour = customStartHour;
      customOptions.customStartMinute = customStartMinute;
      customOptions.customInterval = customInterval;
    }

    const result = await EmailCloner(
      emailIds,
      parseInt(cloningCount, 10),
      strategy,
      customOptions
    );

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        stats: result.stats,
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Cloning error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clone emails.",
      error: error.message,
    });
  }
});

// Add a new route to get all cloned emails from the database
// GET /api/cloned-emails?date=YYYY-MM-DD (optional date filter)
router.get("/cloned-emails", ensureAuthenticated, async (req, res) => {
  try {
    let query = {};

    // Calculate date 31 days ago for retention policy
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - 31);

    if (req.query.date) {
      // Parse date and filter for that day (00:00:00 to 23:59:59)
      const start = new Date(req.query.date);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      // Also apply 31-day retention filter
      query.scheduledTime = { $gte: start, $lt: end };
      query.createdAt = { $gte: retentionDate };
    } else {
      // Only show last 31 days of emails
      query.createdAt = { $gte: retentionDate };
    }

    const clonedEmails = await ClonedEmail.find(query).sort({ createdAt: -1 });
    res.json({
      success: true,
      data: clonedEmails
    });
  } catch (error) {
    console.error("Error fetching cloned emails:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cloned emails.",
      error: error.message,
    });
  }
});

// Add a route to delete cloned emails from database and HubSpot
router.delete("/cloned-emails/:id", ensureAuthenticated, async (req, res) => {
  try {
    const clonedEmail = await ClonedEmail.findById(req.params.id);
    if (!clonedEmail) {
      return res.status(404).json({
        success: false,
        message: "Cloned email not found",
      });
    }

    let hubspotDeleted = false;
    let hubspotError = null;

    // Try to delete from HubSpot first using the same BASE_URL pattern as other API calls
    if (clonedEmail.clonedEmailId) {
      try {
        console.log(`Attempting to delete email ${clonedEmail.clonedEmailId} from HubSpot using URL: ${BASE_URL}/${clonedEmail.clonedEmailId}`);

        const deleteResponse = await axios.delete(
          `${BASE_URL}/${clonedEmail.clonedEmailId}`,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        hubspotDeleted = true;
        console.log(`✓ Successfully deleted email ${clonedEmail.clonedEmailId} from HubSpot. Response status: ${deleteResponse.status}`);
      } catch (hubspotErr) {
        hubspotError = hubspotErr.response?.data?.message || hubspotErr.message;
        console.error(`✗ Failed to delete email ${clonedEmail.clonedEmailId} from HubSpot:`, hubspotError);
        console.error('HubSpot API Error Details:', hubspotErr.response?.data || hubspotErr.message);
      }
    }

    // Delete from database regardless of HubSpot result
    await ClonedEmail.findByIdAndDelete(req.params.id);

    const responseMessage = hubspotDeleted
      ? "Cloned email deleted successfully from both database and HubSpot"
      : hubspotError
        ? `Cloned email deleted from database, but failed to delete from HubSpot: ${hubspotError}`
        : "Cloned email deleted from database (no HubSpot ID found)";

    res.json({
      success: true,
      message: responseMessage,
      hubspotDeleted,
      hubspotError
    });
  } catch (error) {
    console.error("Error deleting cloned email:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete cloned email.",
      error: error.message,
    });
  }
});

// Publish email endpoint - V3 API
router.post("/publish-email", ensureAuthenticated, async (req, res) => {
  const { emailId, scheduleTime } = req.body;

  try {
    // Look up the cloned email in our database
    const clonedEmail = await ClonedEmail.findOne({ clonedEmailId: emailId });

    // If scheduleTime provided, update draft with publishDate before publishing
    if (scheduleTime) {
      try {
        await axios.patch(
          `https://api.hubapi.com/marketing/v3/emails/${emailId}/draft`,
          {
            publishDate: new Date(scheduleTime).toISOString(),
            sendOnPublish: true
          },
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`📅 Email ${emailId} scheduled for: ${new Date(scheduleTime).toISOString()}`);
      } catch (scheduleError) {
        console.error(`⚠️ Failed to set schedule time: ${scheduleError.message}`);
      }
    }

    // Call HubSpot V3 publish endpoint with NO body
    const response = await axios.post(
      `https://api.hubapi.com/marketing/v3/emails/${emailId}/publish`,
      {},
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Update database status to published
    try {
      if (clonedEmail) {
        clonedEmail.status = 'published';
        clonedEmail.publishedAt = new Date();
        if (scheduleTime) {
          clonedEmail.scheduledTime = new Date(scheduleTime);
        }
        await clonedEmail.save();
      }
    } catch (dbError) {
      console.log('Database update error (non-critical):', dbError.message);
    }

    res.json({
      success: true,
      message: scheduleTime ? 'Email scheduled successfully' : 'Email published immediately',
      data: response.data
    });

  } catch (error) {
    console.error('API Error:', {
      status: error.response?.status,
      message: error.message,
      response: error.response?.data
    });

    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to publish email',
      error: error.response?.data || error.message
    });
  }
});

router.get("/cloner", ensureAuthenticated, async (req, res) => {
  try {
    res.status(200).render("cloner", {
      pageTitle: "Email cloning",
      activePage: "email cloning",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Unable to get emails" });
  }
});

module.exports = router;