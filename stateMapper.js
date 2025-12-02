/**
 * State Mapping Utility
 * 
 * Maps GitHub issue states and project statuses to Azure DevOps work item states
 * based on the configuration JSON file provided by the user.
 */

const fs = require('fs');
const path = require('path');

class StateMapper {
  constructor(configPath = null) {
    // Load state mapping configuration
    if (configPath && fs.existsSync(configPath)) {
      this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else {
      // Default fallback configuration
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * Get ADO state based on GitHub issue state, project, and project status
   * 
   * @param {string} workItemType - ADO work item type (Epic, Bug, Product Backlog Item, Task)
   * @param {string} issueState - GitHub issue state (open/closed)
   * @param {string} projectName - GitHub project name (siwar, falak, balsam)
   * @param {string} projectStatus - GitHub project status column (e.g., "In Progress", "Done")
   * @returns {string} ADO state (e.g., "New", "Active", "Done")
   */
  getAdoState(workItemType, issueState, projectName = null, projectStatus = null) {
    // Normalize inputs
    issueState = (issueState || 'open').toLowerCase();
    projectName = (projectName || this.config.defaultProject).toLowerCase();
    
    // If no project info, use global fallback
    if (!projectStatus || !this.config.projects[projectName]) {
      return this.getGlobalFallback(issueState);
    }

    // Get project-specific mapping
    const project = this.config.projects[projectName];
    const statusMappings = project.statusMappings[workItemType];

    if (!statusMappings) {
      console.log(`Warning: No status mapping for work item type: ${workItemType}`);
      return this.getGlobalFallback(issueState);
    }

    // Get state mapping for open or closed issues
    const stateMap = statusMappings[issueState];
    
    if (!stateMap) {
      return this.getGlobalFallback(issueState);
    }

    // Check for wildcard mapping (closed issues typically use "*")
    if (stateMap["*"]) {
      return stateMap["*"];
    }

    // Look for specific project status mapping
    const adoState = stateMap[projectStatus];
    
    if (adoState) {
      return adoState;
    }

    // Fallback to "No status" or first available mapping
    if (stateMap["No status"] || stateMap["No Status"]) {
      return stateMap["No status"] || stateMap["No Status"];
    }

    // Ultimate fallback
    return this.getGlobalFallback(issueState);
  }

  /**
   * Get global fallback state when project-specific mapping not available
   */
  getGlobalFallback(issueState) {
    const fallbacks = this.config.globalSettings.unmappedStatusFallback;
    return fallbacks[issueState] || (issueState === 'closed' ? 'Done' : 'New');
  }

  /**
   * Get ADO area path for a project
   */
  getAreaPath(projectName) {
    projectName = (projectName || this.config.defaultProject).toLowerCase();
    const project = this.config.projects[projectName];
    
    if (project && project.adoAreaPath) {
      return project.adoAreaPath;
    }

    // Fallback to project name
    return projectName;
  }

  /**
   * Get work item type based on GitHub issue title
   */
  getWorkItemType(issueTitle, labels = []) {
    // Check title prefixes from config
    const typeMapping = this.config.workItemTypeMapping;
    
    for (const [prefix, adoType] of Object.entries(typeMapping)) {
      if (prefix === 'default') continue;
      
      // Case-insensitive match at start of title
      const regex = new RegExp(`^\\${prefix}`, 'i');
      if (regex.test(issueTitle)) {
        return adoType;
      }
    }

    // Check labels as fallback
    const labelMap = {
      'epic': 'Epic',
      'bug': 'Bug',
      'user-story': 'Product Backlog Item',
      'task': 'Task'
    };

    for (const label of labels) {
      const labelLower = label.toLowerCase();
      if (labelMap[labelLower]) {
        return labelMap[labelLower];
      }
    }

    // Return default
    return typeMapping.default || 'Product Backlog Item';
  }

  /**
   * Get all available projects
   */
  getProjects() {
    return Object.keys(this.config.projects);
  }

  /**
   * Validate if project exists in configuration
   */
  isValidProject(projectName) {
    return this.config.projects.hasOwnProperty(projectName.toLowerCase());
  }

  /**
   * Get closed issue handling based on project status
   */
  getClosedIssueState(inProduction = false, hasProject = true) {
    const handling = this.config.globalSettings.closedIssueHandling;
    
    if (!hasProject) {
      return handling.noProject;
    }
    
    return inProduction ? handling.inProduction : handling.notInProduction;
  }

  /**
   * Default configuration if file not found
   */
  getDefaultConfig() {
    return {
      "version": "1.0",
      "defaultProject": "siwar",
      "globalSettings": {
        "closedIssueHandling": {
          "inProduction": "Done",
          "notInProduction": "Done",
          "noProject": "Done"
        },
        "unmappedStatusFallback": {
          "open": "New",
          "closed": "Done"
        }
      },
      "workItemTypeMapping": {
        "[Epic]": "Epic",
        "[Story]": "Product Backlog Item",
        "[Request]": "Product Backlog Item",
        "[IMPROVEMENT]": "Product Backlog Item",
        "[Bug]": "Bug",
        "default": "Product Backlog Item"
      },
      "projects": {
        "siwar": {
          "name": "siwar",
          "adoAreaPath": "سوار\\سوار Team",
          "statusMappings": {
            "Epic": {
              "open": {
                "No status": "New",
                "Product Backlog": "New",
                "Sprint Backlog": "New",
                "Ready": "New",
                "In Progress": "In Progress",
                "In PR review": "In Progress",
                "In Beta": "In Progress",
                "In Main": "In Progress",
                "In Production": "Done"
              },
              "closed": { "*": "Done" }
            },
            "Product Backlog Item": {
              "open": {
                "No status": "New",
                "Product Backlog": "New",
                "Sprint Backlog": "Approved",
                "Ready": "Approved",
                "In Progress": "Committed",
                "In PR review": "Committed",
                "In Beta": "Committed",
                "In Main": "Committed",
                "In Production": "Done"
              },
              "closed": { "*": "Done" }
            },
            "Bug": {
              "open": {
                "No status": "New",
                "Product Backlog": "New",
                "Sprint Backlog": "Approved",
                "Ready": "Approved",
                "In Progress": "Committed",
                "In PR review": "Committed",
                "In Beta": "Committed",
                "In Main": "Committed",
                "In Production": "Done"
              },
              "closed": { "*": "Done" }
            },
            "Task": {
              "open": {
                "No status": "To Do",
                "Product Backlog": "To Do",
                "Sprint Backlog": "To Do",
                "Ready": "To Do",
                "In Progress": "In Progress",
                "In PR review": "In Progress",
                "In Beta": "In Progress",
                "In Main": "In Progress",
                "In Production": "Done"
              },
              "closed": { "*": "Done" }
            }
          }
        }
      }
    };
  }

  /**
   * Log current configuration (for debugging)
   */
  logConfig(logLevel = 200) {
    if (logLevel >= 300) {
      console.log("=== State Mapper Configuration ===");
      console.log(JSON.stringify(this.config, null, 2));
      console.log("==================================");
    }
  }
}

module.exports = StateMapper;
