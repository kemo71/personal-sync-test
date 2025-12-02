/**
 * Iteration Creator Utility
 * 
 * Programmatically creates iterations (sprints) in Azure DevOps
 * Parses sprint names and dates from GitHub to create ADO iterations
 */

const azdev = require('azure-devops-node-api');

class IterationCreator {
  constructor(adoToken, organization, project) {
    this.adoToken = adoToken;
    this.organization = organization;
    this.project = project;
    this.orgUrl = `https://dev.azure.com/Myownpersonalorganizationtest`;
    
    this.connection = null;
    this.workClient = null;
    
    // Cache of existing iterations to avoid duplicate checks
    this.existingIterations = new Map();
    this.cacheLoaded = false;
  }

  /**
   * Initialize the ADO connection
   */
  async initialize() {
    if (this.connection) return;

    const authHandler = azdev.getHandlerFromToken(this.adoToken);
    this.connection = new azdev.WebApi(this.orgUrl, authHandler);
    this.workClient = await this.connection.getWorkApi();
  }

  /**
   * Load all existing iterations into cache
   */
  async loadExistingIterations() {
    if (this.cacheLoaded) return;

    await this.initialize();

    try {
      const teamContext = { project: this.project };
      const iterations = await this.workClient.getTeamIterations(teamContext);
      
      iterations.forEach(iteration => {
        this.existingIterations.set(iteration.name.toLowerCase(), iteration);
      });

      this.cacheLoaded = true;
      console.log(`Loaded ${this.existingIterations.size} existing iterations from ADO`);
    } catch (error) {
      console.error('Error loading existing iterations:', error.message);
    }
  }

  /**
   * Check if iteration exists
   * @param {string} iterationName - Name of the iteration
   * @returns {boolean} True if exists
   */
  async iterationExists(iterationName) {
    await this.loadExistingIterations();
    return this.existingIterations.has(iterationName.toLowerCase());
  }

  /**
   * Get existing iteration
   * @param {string} iterationName - Name of the iteration
   * @returns {Object|null} Iteration object or null
   */
  async getIteration(iterationName) {
    await this.loadExistingIterations();
    return this.existingIterations.get(iterationName.toLowerCase()) || null;
  }

  /**
   * Create an iteration in Azure DevOps
   * @param {string} iterationName - Name of the iteration
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} path - Iteration path (default: project root)
   * @returns {Object} Created iteration
   */
  async createIteration(iterationName, startDate, endDate, path = null) {
    await this.initialize();

    // Check if already exists
    if (await this.iterationExists(iterationName)) {
      console.log(`Iteration '${iterationName}' already exists, skipping creation`);
      return await this.getIteration(iterationName);
    }

    try {
      const teamContext = { project: this.project };
      
      const iteration = {
        name: iterationName,
        attributes: {
          startDate: startDate ? this.formatDate(startDate) : null,
          finishDate: endDate ? this.formatDate(endDate) : null
        },
        path: path || `\\${this.project}\\${iterationName}`
      };

      const created = await this.workClient.postTeamIteration(iteration, teamContext);
      
      // Add to cache
      this.existingIterations.set(iterationName.toLowerCase(), created);
      
      console.log(`Created iteration: ${iterationName} (${startDate} to ${endDate})`);
      return created;
    } catch (error) {
      console.error(`Error creating iteration '${iterationName}':`, error.message);
      return null;
    }
  }

  /**
   * Parse sprint name to extract dates
   * Examples:
   *   "Sprint 68 oct 13 - oct 26"
   *   "Sprint 70 Nov 10 - Nov 23"
   */
  parseSprintDates(sprintName, year = new Date().getFullYear()) {
    // Regular expressions for different date formats
    const patterns = [
      // "oct 13 - oct 26" format
      /(\w+)\s+(\d+)\s*-\s*(\w+)\s+(\d+)/i,
      // "10/13 - 10/26" format
      /(\d+)\/(\d+)\s*-\s*(\d+)\/(\d+)/,
      // "2024-10-13 to 2024-10-26" format
      /(\d{4})-(\d{2})-(\d{2})\s+to\s+(\d{4})-(\d{2})-(\d{2})/
    ];

    for (const pattern of patterns) {
      const match = sprintName.match(pattern);
      if (match) {
        return this.extractDatesFromMatch(match, year);
      }
    }

    // If no dates found, return null
    return null;
  }

  /**
   * Extract dates from regex match
   */
  extractDatesFromMatch(match, year) {
    try {
      // Month name format: "oct 13 - oct 26"
      if (isNaN(match[1])) {
        const startMonth = this.parseMonth(match[1]);
        const startDay = parseInt(match[2]);
        const endMonth = this.parseMonth(match[3]);
        const endDay = parseInt(match[4]);

        return {
          startDate: new Date(year, startMonth, startDay),
          endDate: new Date(year, endMonth, endDay)
        };
      }
      
      // Numeric format: "10/13 - 10/26"
      if (match.length === 5) {
        const startMonth = parseInt(match[1]) - 1;  // Month is 0-indexed
        const startDay = parseInt(match[2]);
        const endMonth = parseInt(match[3]) - 1;
        const endDay = parseInt(match[4]);

        return {
          startDate: new Date(year, startMonth, startDay),
          endDate: new Date(year, endMonth, endDay)
        };
      }

      // ISO format: "2024-10-13 to 2024-10-26"
      if (match.length === 7) {
        return {
          startDate: new Date(match[1], parseInt(match[2]) - 1, match[3]),
          endDate: new Date(match[4], parseInt(match[5]) - 1, match[6])
        };
      }
    } catch (error) {
      console.error('Error parsing dates from match:', error.message);
    }

    return null;
  }

  /**
   * Parse month name to number (0-11)
   */
  parseMonth(monthStr) {
    const months = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11
    };

    return months[monthStr.toLowerCase()] || 0;
  }

  /**
   * Create iteration from sprint info
   * @param {Object} sprintInfo - Sprint information from GitHub Projects
   * @param {number} defaultDuration - Default duration in days if dates not available
   * @returns {Object} Created/existing iteration
   */
  async createFromSprintInfo(sprintInfo, defaultDuration = 14) {
    if (!sprintInfo || !sprintInfo.name) {
      return null;
    }

    // Check if we have explicit dates from GitHub Projects
    let startDate = sprintInfo.startDate ? new Date(sprintInfo.startDate) : null;
    let endDate = null;

    if (startDate && sprintInfo.duration) {
      // Calculate end date from start + duration
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + sprintInfo.duration);
    } else if (!startDate) {
      // Try to parse dates from sprint name
      const parsed = this.parseSprintDates(sprintInfo.name);
      if (parsed) {
        startDate = parsed.startDate;
        endDate = parsed.endDate;
      }
    }

    // If still no dates, use current date + default duration
    if (!startDate) {
      startDate = new Date();
      endDate = new Date();
      endDate.setDate(endDate.getDate() + defaultDuration);
      console.log(`Warning: No dates found for sprint '${sprintInfo.name}', using defaults`);
    }

    // Create the iteration
    return await this.createIteration(sprintInfo.name, startDate, endDate);
  }

  /**
   * Batch create iterations from a list of sprint names
   * @param {Array<string>} sprintNames - List of sprint names
   * @param {number} defaultDuration - Default sprint duration in days
   * @returns {Array<Object>} Created iterations
   */
  async batchCreateIterations(sprintNames, defaultDuration = 14) {
    const results = [];

    for (const sprintName of sprintNames) {
      const sprintInfo = { name: sprintName };
      const iteration = await this.createFromSprintInfo(sprintInfo, defaultDuration);
      
      if (iteration) {
        results.push(iteration);
      }

      // Rate limiting delay
      await this.delay(500);
    }

    return results;
  }

  /**
   * Get iteration path for a sprint name
   * @param {string} sprintName - Sprint name
   * @returns {string} Iteration path
   */
  getIterationPath(sprintName) {
    return `${this.project}\\${sprintName}`;
  }

  /**
   * Format date for ADO API (YYYY-MM-DD)
   */
  formatDate(date) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /**
   * Helper: Delay for rate limiting
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get iteration statistics
   */
  getStats() {
    return {
      cachedIterations: this.existingIterations.size,
      cacheLoaded: this.cacheLoaded
    };
  }

  /**
   * Log iterations (for debugging)
   */
  logIterations(logLevel = 200) {
    if (logLevel >= 300) {
      console.log("=== Cached Iterations ===");
      this.existingIterations.forEach((iteration, name) => {
        console.log(`  ${name}: ${iteration.path}`);
      });
      console.log(`Total: ${this.existingIterations.size}`);
      console.log("========================");
    } else if (logLevel >= 200) {
      console.log(`Iterations in cache: ${this.existingIterations.size}`);
    }
  }
}

module.exports = IterationCreator;
