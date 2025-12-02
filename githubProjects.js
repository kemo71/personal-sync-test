/**
 * GitHub Projects v2 API Utility
 * 
 * Fetches data from GitHub Projects (GraphQL API)
 * to get project status, sprint information, and custom fields
 */

const { graphql } = require('@octokit/graphql');

class GitHubProjectsClient {
  constructor(githubToken) {
    this.graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`,
      },
    });
  }

  /**
   * Get project information for an issue
   * @param {string} org - Organization name
   * @param {number} issueNumber - Issue number
   * @param {string} repo - Repository name
   * @returns {Object} Project information
   */
  async getIssueProjectInfo(org, repo, issueNumber) {
    try {
      const query = `
        query($org: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $org, name: $repo) {
            issue(number: $issueNumber) {
              projectItems(first: 10) {
                nodes {
                  project {
                    title
                    number
                  }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field {
                          ... on ProjectV2FieldCommon {
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldTextValue {
                        text
                        field {
                          ... on ProjectV2FieldCommon {
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldDateValue {
                        date
                        field {
                          ... on ProjectV2FieldCommon {
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldNumberValue {
                        number
                        field {
                          ... on ProjectV2FieldCommon {
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldIterationValue {
                        title
                        startDate
                        duration
                        field {
                          ... on ProjectV2FieldCommon {
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const result = await this.graphqlWithAuth(query, {
        org,
        repo,
        issueNumber,
      });

      return this.parseProjectInfo(result);
    } catch (error) {
      console.error(`Error fetching project info for issue #${issueNumber}:`, error.message);
      return null;
    }
  }

  /**
   * Parse project information from GraphQL response
   */
  parseProjectInfo(result) {
    const projectItems = result?.repository?.issue?.projectItems?.nodes || [];
    
    if (projectItems.length === 0) {
      return null;
    }

    // Get first project (issue can be in multiple projects)
    const projectItem = projectItems[0];
    const projectInfo = {
      projectName: projectItem.project.title,
      projectNumber: projectItem.project.number,
      fields: {}
    };

    // Parse field values
    const fieldValues = projectItem.fieldValues?.nodes || [];
    
    for (const fieldValue of fieldValues) {
      const fieldName = fieldValue.field?.name;
      
      if (!fieldName) continue;

      // Extract value based on type
      if (fieldValue.name) {
        // SingleSelect (like Status)
        projectInfo.fields[fieldName] = fieldValue.name;
      } else if (fieldValue.text) {
        // Text field
        projectInfo.fields[fieldName] = fieldValue.text;
      } else if (fieldValue.date) {
        // Date field
        projectInfo.fields[fieldName] = fieldValue.date;
      } else if (fieldValue.number !== undefined) {
        // Number field
        projectInfo.fields[fieldName] = fieldValue.number;
      } else if (fieldValue.title) {
        // Iteration field
        projectInfo.fields[fieldName] = {
          title: fieldValue.title,
          startDate: fieldValue.startDate,
          duration: fieldValue.duration
        };
      }
    }

    return projectInfo;
  }

  /**
   * Get project status (column) for an issue
   * Common field names: Status, State, Column
   */
  getProjectStatus(projectInfo) {
    if (!projectInfo || !projectInfo.fields) {
      return null;
    }

    // Try common field names
    const statusFields = ['Status', 'State', 'Column'];
    
    for (const fieldName of statusFields) {
      if (projectInfo.fields[fieldName]) {
        return projectInfo.fields[fieldName];
      }
    }

    return null;
  }

  /**
   * Get sprint/iteration information from project
   */
  getSprintInfo(projectInfo) {
    if (!projectInfo || !projectInfo.fields) {
      return null;
    }

    // Try common sprint field names
    const sprintFields = ['Sprint', 'Iteration'];
    
    for (const fieldName of sprintFields) {
      const value = projectInfo.fields[fieldName];
      if (value) {
        // If it's an iteration object with dates
        if (typeof value === 'object' && value.title) {
          return {
            name: value.title,
            startDate: value.startDate,
            duration: value.duration
          };
        }
        // If it's just a string
        if (typeof value === 'string') {
          return {
            name: value,
            startDate: null,
            duration: null
          };
        }
      }
    }

    return null;
  }

  /**
   * Get custom field value
   */
  getCustomField(projectInfo, fieldName) {
    if (!projectInfo || !projectInfo.fields) {
      return null;
    }

    return projectInfo.fields[fieldName] || null;
  }

  /**
   * Get project name in normalized form
   */
  getProjectName(projectInfo) {
    if (!projectInfo) {
      return null;
    }

    // Normalize project name to lowercase for matching
    return projectInfo.projectName?.toLowerCase() || null;
  }

  /**
   * Format custom fields for ADO comment
   * @param {Object} projectInfo - Project information
   * @returns {string} Formatted comment text
   */
  formatCustomFieldsComment(projectInfo) {
    if (!projectInfo || !projectInfo.fields) {
      return '';
    }

    const fields = projectInfo.fields;
    const lines = ['**GitHub Projects Custom Fields:**', ''];

    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      // Skip standard fields
      if (['Status', 'State', 'Column', 'Sprint', 'Iteration'].includes(fieldName)) {
        continue;
      }

      // Format value
      let formattedValue = fieldValue;
      if (typeof fieldValue === 'object') {
        formattedValue = JSON.stringify(fieldValue);
      }

      lines.push(`- **${fieldName}**: ${formattedValue}`);
    }

    return lines.join('\n');
  }

  /**
   * Batch fetch project info for multiple issues
   * @param {string} org - Organization name
   * @param {string} repo - Repository name
   * @param {Array<number>} issueNumbers - Array of issue numbers
   * @returns {Map<number, Object>} Map of issue number to project info
   */
  async batchGetProjectInfo(org, repo, issueNumbers) {
    const results = new Map();

    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < issueNumbers.length; i += batchSize) {
      const batch = issueNumbers.slice(i, i + batchSize);
      
      const promises = batch.map(async (issueNumber) => {
        const info = await this.getIssueProjectInfo(org, repo, issueNumber);
        return [issueNumber, info];
      });

      const batchResults = await Promise.all(promises);
      batchResults.forEach(([issueNumber, info]) => {
        results.set(issueNumber, info);
      });

      // Rate limiting delay
      if (i + batchSize < issueNumbers.length) {
        await this.delay(1000); // 1 second delay between batches
      }
    }

    return results;
  }

  /**
   * Helper: Delay for rate limiting
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all projects for an organization
   */
  async getOrgProjects(org) {
    try {
      const query = `
        query($org: String!) {
          organization(login: $org) {
            projectsV2(first: 20) {
              nodes {
                title
                number
                url
              }
            }
          }
        }
      `;

      const result = await this.graphqlWithAuth(query, { org });
      return result.organization.projectsV2.nodes;
    } catch (error) {
      console.error('Error fetching org projects:', error.message);
      return [];
    }
  }

  /**
   * Log project info (for debugging)
   */
  logProjectInfo(projectInfo, logLevel = 200) {
    if (logLevel >= 300 && projectInfo) {
      console.log("=== Project Info ===");
      console.log(`Project: ${projectInfo.projectName} (#${projectInfo.projectNumber})`);
      console.log("Fields:");
      for (const [name, value] of Object.entries(projectInfo.fields)) {
        console.log(`  ${name}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      }
      console.log("===================");
    }
  }
}

module.exports = GitHubProjectsClient;
