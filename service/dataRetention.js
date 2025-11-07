const ClonedEmail = require('../models/clonedEmail');
const CreatedList = require('../models/list');

// Configuration - Keep only last 31 days of data
const RETENTION_DAYS = 31;

/**
 * Calculate the cutoff date for data retention
 * @returns {Date} Date object representing the cutoff (data older than this will be deleted)
 */
function getRetentionCutoffDate() {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));
  return cutoffDate;
}

/**
 * Delete cloned emails older than 31 days from MongoDB
 * @returns {Promise<Object>} Result with count of deleted documents
 */
async function cleanupOldClonedEmails() {
  try {
    const cutoffDate = getRetentionCutoffDate();

    const result = await ClonedEmail.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    console.log(`[Data Retention] Deleted ${result.deletedCount} cloned emails older than ${RETENTION_DAYS} days (before ${cutoffDate.toISOString()})`);

    return {
      success: true,
      deletedCount: result.deletedCount,
      cutoffDate: cutoffDate
    };
  } catch (error) {
    console.error('[Data Retention] Error cleaning up cloned emails:', error);
    return {
      success: false,
      error: error.message,
      deletedCount: 0
    };
  }
}

/**
 * Delete created lists older than 31 days from MongoDB
 * @returns {Promise<Object>} Result with count of deleted documents
 */
async function cleanupOldCreatedLists() {
  try {
    const cutoffDate = getRetentionCutoffDate();

    const result = await CreatedList.deleteMany({
      createdDate: { $lt: cutoffDate }
    });

    console.log(`[Data Retention] Deleted ${result.deletedCount} created lists older than ${RETENTION_DAYS} days (before ${cutoffDate.toISOString()})`);

    return {
      success: true,
      deletedCount: result.deletedCount,
      cutoffDate: cutoffDate
    };
  } catch (error) {
    console.error('[Data Retention] Error cleaning up created lists:', error);
    return {
      success: false,
      error: error.message,
      deletedCount: 0
    };
  }
}

/**
 * Run complete data retention cleanup for both emails and lists
 * @returns {Promise<Object>} Combined results from all cleanup operations
 */
async function runDataRetentionCleanup() {
  console.log(`[Data Retention] Starting cleanup - deleting data older than ${RETENTION_DAYS} days`);

  const results = {
    timestamp: new Date().toISOString(),
    retentionDays: RETENTION_DAYS,
    clonedEmails: await cleanupOldClonedEmails(),
    createdLists: await cleanupOldCreatedLists()
  };

  console.log('[Data Retention] Cleanup completed:', {
    clonedEmailsDeleted: results.clonedEmails.deletedCount,
    createdListsDeleted: results.createdLists.deletedCount,
    totalDeleted: results.clonedEmails.deletedCount + results.createdLists.deletedCount
  });

  return results;
}

module.exports = {
  runDataRetentionCleanup,
  cleanupOldClonedEmails,
  cleanupOldCreatedLists,
  getRetentionCutoffDate,
  RETENTION_DAYS
};
