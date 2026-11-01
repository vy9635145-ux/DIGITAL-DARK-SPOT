'use strict';
module.exports = {
  CATEGORIES: ['Education', 'Scholarships', 'Technology', 'Government Policies', 'Healthcare Information', 'Environment', 'Finance', 'Science', 'General Research', 'Other'],
  SETTING_DEFAULTS: { default_category: 'General Research', ai_max_chars_per_source: 12000, report_include_evidence: true, report_include_checklist: true },
  STATUSES: ['created', 'processing', 'completed', 'failed', 'ai_failed'],
  MAX_URLS: 6,
  MAX_TEXT_CHARS: 60000,
  MIN_TEXT_CHARS: 200,
  FRESHNESS_WARNINGS: ['Potentially Outdated', 'Expired Information', 'Undated Source', 'Date Not Available', 'Needs Verification']
};
