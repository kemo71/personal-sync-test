/**
 * Configuration Module for GitHub to Azure DevOps Migration
 * 
 * This file contains all configurable settings for the migration process.
 * Modify these settings to control which features are enabled/disabled.
 */

module.exports = {
  /**
   * Feature Flags - Enable/Disable specific sync features
   * Set to false to skip syncing that metadata type
   */
  features: {
    syncTitle: true,                    // Sync issue title
    syncDescription: true,              // Sync issue body/description
    syncState: true,                    // Sync open/closed state
    syncAssignees: true,                // Sync assignees
    syncLabels: true,                   // Sync labels as tags
    syncComments: true,                 // Sync all comments
    syncDates: true,                    // Preserve created/closed dates (requires bypassRules)
    syncHierarchy: true,                // Preserve parent/child relationships
    syncProjectStatus: true,            // Sync GitHub Projects status to ADO state
    syncPullRequests: true,             // Create work items for PRs
    syncMilestones: false,              // Sync milestones (set to false per user request)
    syncIterations: true,               // Map sprints to iterations
    syncCustomFields: false,            // Sync to custom ADO fields (false = write to comments)
    syncDevelopmentLinks: true,         // Link commits/branches/PRs
    syncReviewers: true,                // Map PR reviewers
    createIterations: true,             // Programmatically create iterations if missing
  },

  /**
   * Work Item Type Detection
   * Order matters - first match wins
   * Format: { pattern: "regex or string", type: "ADO Work Item Type" }
   */
  workItemTypes: {
    patterns: [
      { pattern: /^\[Epic\]/i, type: "Epic" },
      { pattern: /^\[Story\]/i, type: "Product Backlog Item" },
      { pattern: /^\[Request\]/i, type: "Product Backlog Item" },
      { pattern: /^\[IMPROVEMENT\]/i, type: "Product Backlog Item" },
      { pattern: /^\[Bug\]/i, type: "Bug" },
    ],
    labelFallbacks: {
      "epic": "Epic",
      "user-story": "Product Backlog Item",
      "task": "Task",
      "bug": "Bug",
      "spike": "Task",
    },
    default: "Product Backlog Item"
  },

  /**
   * GitHub Projects Configuration
   */
  projects: {
    enabled: true,
    // Project IDs or numbers to sync from
    projectIds: [31, 37],  // From user's URLs
    // Default project if issue not in any project
    defaultProject: "siwar",
  },

  /**
   * Custom Field Mapping Strategy
   * Since custom fields aren't created in ADO, map to comments or built-in fields
   */
  customFields: {
    // Write custom fields to comments if not mapped to ADO fields
    writeToComments: true,
    
    // Mapping from GitHub custom field to ADO field or comment
    mappings: {
      "Business Priority": {
        adoField: "Microsoft.VSTS.Common.Priority",  // 1=High, 2=Normal, 3=Low
        mapping: { "High": 1, "Normal": 2, "Low": 3 },
        fallback: "comment"  // If mapping fails, write to comment
      },
      "Time Priority": {
        adoField: null,  // No direct ADO equivalent
        fallback: "comment"  // Write to comment
      },
      "Time Estimation": {
        adoField: "Microsoft.VSTS.Scheduling.Effort",  // Use Effort field
        fallback: "comment"
      },
      "Start Date": {
        adoField: "Microsoft.VSTS.Scheduling.StartDate",  // Epic start date
        workItemTypes: ["Epic"],  // Only for Epics
        fallback: "comment"
      },
      "End Date": {
        adoField: "Microsoft.VSTS.Scheduling.TargetDate",  // Epic target date  
        workItemTypes: ["Epic"],
        fallback: "comment"
      },
      "Business Value": {
        adoField: "Microsoft.VSTS.Common.BusinessValue",
        fallback: "comment"
      },
      // All other custom fields → comments or tags
      "Product": { fallback: "tag" },
      "Category": { fallback: "tag" },
      "Assignee QA": { fallback: "comment" },
      "Business Owner": { fallback: "comment" },
    }
  },

  /**
   * Pull Request Configuration
   */
  pullRequests: {
    enabled: true,
    // Create as separate work items or just link?
    createWorkItems: true,
    workItemType: "Task",  // What type of work item for PRs
    linkToParentIssue: true,  // Link PR work item to issue work item
    
    // Reviewer mapping
    reviewers: {
      // GitHub reviewers become optional reviewers in ADO
      mapToOptional: true,
      // Also add as comment?
      addAsComment: true,
    },
    
    // PR state mapping
    stateMapping: {
      "open": "To Do",
      "merged": "Done",
      "closed": "Removed"  // Closed without merge
    }
  },

  /**
   * Iteration/Sprint Configuration
   */
  iterations: {
    // Programmatically create iterations if they don't exist
    autoCreate: true,
    
    // Parse sprint name to get dates
    // Example: "Sprint 68 oct 13 - oct 26"
    parseSprintName: true,
    
    // Default sprint duration if can't parse dates (days)
    defaultDuration: 14,
    
    // Root iteration path
    rootPath: "siwar",  // Will be project-specific
    
    // Iteration naming template
    nameTemplate: "Sprint {number}",
  },

  /**
   * Area Path Configuration
   */
  areaPaths: {
    // Can be modified in export - just use any value for now
    allowPlaceholder: true,
    
    // Default area paths per project (from JSON config)
    defaults: {
      "siwar": "سوار\\سوار Team",
      "falak": "فلك\\فلك Team",
      "balsam": "بلسم\\بلسم Team"
    }
  },

  /**
   * Label Handling
   */
  labels: {
    // Keep Arabic labels as-is
    keepArabic: true,
    
    // Labels that map to ADO Priority field
    priorityLabels: {
      "ذات أهمية قصوى": 1,  // Critical
      "blocker": 1,
      "high-priority": 1,
      "مؤجل": 4  // Deferred/Low
    },
    
    // Labels that trigger state changes
    stateLabels: {
      "ReadyForQA": null,  // Don't change state, just tag
      "QaPass": null,
      "QaFailed": null,
    },
    
    // All labels become tags unless mapped above
    allAsTags: true,
  },

  /**
   * Comment Configuration
   */
  comments: {
    // Include GitHub username in comment
    includeAuthor: true,
    
    // Include comment date
    includeDate: true,
    
    // Convert markdown to HTML
    convertMarkdown: true,
    
    // Add link back to GitHub comment
    includeLinkBack: true,
  },

  /**
   * Hierarchy Configuration
   */
  hierarchy: {
    // Preserve parent/child relationships from GitHub
    enabled: true,
    
    // Use GitHub issue relationships (blocked by, depends on, etc.)
    useIssueRelationships: true,
    
    // Also check for parent/child in issue body
    parseBodyForParent: true,
    
    // Link type to use
    linkType: "System.LinkTypes.Hierarchy-Reverse",  // Child → Parent
  },

  /**
   * Error Handling
   */
  errorHandling: {
    // Continue processing even if some issues fail
    continueOnError: true,
    
    // Log failed issues to a file
    logFailures: true,
    failureLogPath: "/tmp/failed_issues.json",
    
    // Retry failed operations
    retryCount: 3,
    retryDelay: 2000,  // ms
  },

  /**
   * Rate Limiting
   */
  rateLimiting: {
    // Delay between API calls (ms)
    delayBetweenCalls: 500,
    
    // Max concurrent requests
    maxConcurrent: 3,
    
    // Batch size for bulk operations
    batchSize: 10,
  },

  /**
   * Logging Configuration
   */
  logging: {
    // Log level: 100=minimal, 200=normal, 300=verbose
    level: 200,
    
    // Log to file
    logToFile: true,
    logFilePath: "/tmp/migration.log",
    
    // Include timestamps
    timestamps: true,
  },

  /**
   * Validation
   */
  validation: {
    // Validate work items after creation
    validateAfterCreate: true,
    
    // Required fields that must be present
    requiredFields: ["System.Title", "System.State"],
    
    // Warn if these are missing but don't fail
    warnFields: ["System.AssignedTo", "System.IterationPath"],
  }
};
