/**
 * User Mapping Utility
 * 
 * Maps GitHub usernames to Azure DevOps user emails/identities
 * Based on the user mapping file provided
 */

const fs = require('fs');

class UserMapper {
  constructor(mappingData = null) {
    this.mapping = new Map();
    
    if (mappingData) {
      this.loadMappingData(mappingData);
    }
  }

  /**
   * Load mapping data from various sources
   * @param {Array|Object|string} data - Array of mappings, object, or file path
   */
  loadMappingData(data) {
    if (typeof data === 'string') {
      // Assume it's a file path
      if (fs.existsSync(data)) {
        const content = fs.readFileSync(data, 'utf8');
        data = JSON.parse(content);
      } else {
        console.error(`User mapping file not found: ${data}`);
        return;
      }
    }

    if (Array.isArray(data)) {
      // Array of {github: "username", ado: "email"}
      data.forEach(item => {
        if (item.github && item.ado) {
          this.mapping.set(item.github.toLowerCase(), item.ado);
        }
      });
    } else if (typeof data === 'object') {
      // Object with github username as key
      Object.entries(data).forEach(([github, ado]) => {
        this.mapping.set(github.toLowerCase(), ado);
      });
    }

    console.log(`Loaded ${this.mapping.size} user mappings`);
  }

  /**
   * Load from JSON string (for environment variable)
   * Format: [["github_user", "ado_email"], ...]
   */
  loadFromJsonString(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (Array.isArray(data)) {
        data.forEach(tuple => {
          if (Array.isArray(tuple) && tuple.length >= 2) {
            this.mapping.set(tuple[0].toLowerCase(), tuple[1]);
          }
        });
      }
    } catch (error) {
      console.error('Error parsing user mapping JSON:', error);
    }
  }

  /**
   * Get ADO user email for a GitHub username
   * @param {string} githubUsername - GitHub username
   * @returns {string|null} ADO email or null if not found
   */
  getAdoUser(githubUsername) {
    if (!githubUsername) return null;
    
    const adoUser = this.mapping.get(githubUsername.toLowerCase());
    
    if (!adoUser) {
      console.log(`Warning: No ADO mapping found for GitHub user: ${githubUsername}`);
    }
    
    return adoUser || null;
  }

  /**
   * Get ADO users for multiple GitHub usernames
   * @param {Array<string>} githubUsernames - Array of GitHub usernames
   * @returns {Array<string>} Array of ADO emails (only mapped users)
   */
  getAdoUsers(githubUsernames) {
    if (!Array.isArray(githubUsernames)) {
      return [];
    }

    return githubUsernames
      .map(username => this.getAdoUser(username))
      .filter(email => email !== null);
  }

  /**
   * Get primary ADO user (first in list)
   * @param {Array<string>} githubUsernames - Array of GitHub usernames
   * @returns {string|null} Primary ADO email or null
   */
  getPrimaryAdoUser(githubUsernames) {
    const adoUsers = this.getAdoUsers(githubUsernames);
    return adoUsers.length > 0 ? adoUsers[0] : null;
  }

  /**
   * Get additional ADO users (all except first)
   * @param {Array<string>} githubUsernames - Array of GitHub usernames
   * @returns {Array<string>} Additional ADO emails
   */
  getAdditionalAdoUsers(githubUsernames) {
    const adoUsers = this.getAdoUsers(githubUsernames);
    return adoUsers.slice(1);
  }

  /**
   * Check if a GitHub user has a mapping
   * @param {string} githubUsername - GitHub username
   * @returns {boolean} True if mapping exists
   */
  hasmapping(githubUsername) {
    if (!githubUsername) return false;
    return this.mapping.has(githubUsername.toLowerCase());
  }

  /**
   * Get all GitHub users that have mappings
   * @returns {Array<string>} Array of GitHub usernames
   */
  getMappedGithubUsers() {
    return Array.from(this.mapping.keys());
  }

  /**
   * Get all ADO users
   * @returns {Array<string>} Array of ADO emails
   */
  getAllAdoUsers() {
    return Array.from(this.mapping.values());
  }

  /**
   * Get mapping statistics
   * @returns {Object} Statistics about the mapping
   */
  getStats() {
    return {
      totalMappings: this.mapping.size,
      githubUsers: this.getMappedGithubUsers(),
      adoUsers: this.getAllAdoUsers()
    };
  }

  /**
   * Export mappings to JSON format
   * @returns {Array} Array of {github, ado} objects
   */
  exportToJson() {
    return Array.from(this.mapping.entries()).map(([github, ado]) => ({
      github,
      ado
    }));
  }

  /**
   * Add a single mapping
   * @param {string} githubUsername - GitHub username
   * @param {string} adoEmail - ADO email
   */
  addMapping(githubUsername, adoEmail) {
    if (githubUsername && adoEmail) {
      this.mapping.set(githubUsername.toLowerCase(), adoEmail);
    }
  }

  /**
   * Remove a mapping
   * @param {string} githubUsername - GitHub username
   */
  removeMapping(githubUsername) {
    this.mapping.delete(githubUsername.toLowerCase());
  }

  /**
   * Clear all mappings
   */
  clearAll() {
    this.mapping.clear();
  }

  /**
   * Log current mappings (for debugging)
   */
  logMappings(logLevel = 200) {
    if (logLevel >= 300) {
      console.log("=== User Mappings ===");
      this.mapping.forEach((ado, github) => {
        console.log(`  ${github} → ${ado}`);
      });
      console.log(`Total: ${this.mapping.size} mappings`);
      console.log("====================");
    } else if (logLevel >= 200) {
      console.log(`User mappings loaded: ${this.mapping.size} users`);
    }
  }
}

module.exports = UserMapper;
