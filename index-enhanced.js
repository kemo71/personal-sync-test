/**
 * Enhanced GitHub Issues to Azure DevOps Work Items Sync
 * 
 * This is an enhanced version that supports:
 * - Manual trigger for bulk migration
 * - Full metadata synchronization
 * - GitHub Projects v2 integration
 * - Hierarchy preservation
 * - Pull Request syncing
 * - Programmatic iteration creation
 * - Comprehensive state mapping
 * - Custom field handling
 * 
 * Based on: ni/ni-github-actions-issue-to-work-item
 * Enhanced for: Comprehensive migration with configurability
 */

// === DEPENDENCIES ===
const core = require('@actions/core');
const github = require('@actions/github');
const azdev = require('azure-devops-node-api');
const showdown = require('showdown');
const { Octokit } = require('@octokit/rest');

// === CUSTOM MODULES ===
// Import our custom utility modules
const config = require('./config');
const StateMapper = require('./stateMapper');
const UserMapper = require('./userMapper');
const GitHubProjectsClient = require('./githubProjects');
const IterationCreator = require('./iterationCreator');

// === DEBUG MODE ===
const debug = true; // Set to false before production deployment

// === MAIN ENTRY POINT ===
main();

/**
 * Main function - Entry point for the GitHub Action
 * Handles both event-driven (push/issue events) and manual (workflow_dispatch) triggers
 */
async function main() {
  if (debug) console.log('⚠️  WARNING! You are in debug mode');
  
  try {
    const context = github.context;
    const env = process.env;

    // === INITIALIZATION ===
    console.log('🚀 Starting GitHub to Azure DevOps migration...');
    
    // Determine if this is a bulk migration or single event
    const isBulkMigration = env.MIGRATION_MODE && env.MIGRATION_MODE !== 'single';
    
    if (isBulkMigration) {
      console.log(`📦 Bulk migration mode: ${env.MIGRATION_MODE}`);
      await handleBulkMigration(env);
    } else {
      console.log('📝 Single issue sync mode');
      await handleSingleIssue(context, env);
    }

    console.log('✅ Migration completed successfully');

  } catch (error) {
    console.error('❌ Error in main function:', error);
    console.error(error.stack);
    core.setFailed(error.message);
  }
}

/**
 * Handle single issue sync (event-driven)
 * This is triggered by GitHub events like issue opened, closed, etc.
 */
async function handleSingleIssue(context, env) {
  // Initialize utilities
  const stateMapper = initializeStateMapper(env);
  const userMapper = initializeUserMapper(env);
  
  // Get values from payload
  let vm = getValuesFromPayload(context.payload, env);

  // Skip if sender is azure-boards bot (avoid infinite loops)
  if (vm.sender_login === "azure-boards[bot]") {
    console.log('🤖 azure-boards[bot] sender detected, exiting to avoid loop');
    return;
  }

  // Initialize GitHub Projects client if enabled
  let projectsClient = null;
  if (config.features.syncProjectStatus && env.github_token) {
    projectsClient = new GitHubProjectsClient(env.github_token);
    console.log(` projectsClient: ${JSON.stringify(projectsClient)}`);
  }

  // Fetch GitHub Projects data if available
  let projectInfo = null;
  if (projectsClient && vm.owner && vm.repository && vm.number) {
    projectInfo = await projectsClient.getIssueProjectInfo(vm.owner, vm.repository, vm.number);


 
  console.log(` projectInfo: ${JSON.stringify(projectInfo)}`);
  console.log(` context: ${JSON.stringify(context)}`);
  console.log(` vm: ${JSON.stringify(vm)} github token: ${env.github_token}`);
  console.log(` owner: ${JSON.stringify(vm.owner)} repository: ${JSON.stringify(vm.repository)} number: ${JSON.stringify(vm.number)} areaPath: ${JSON.stringify(vm.areaPath)}`);
  projectsClient.logProjectInfo(projectInfo, config.logging.level);  
    
    if (projectInfo) {
      console.log(`📊 Found project info: ${projectInfo.projectName}`);
      if (config.logging.level >= 300) {
        projectsClient.logProjectInfo(projectInfo, config.logging.level);
      }
    }
  }

  // === FIND OR CREATE WORK ITEM ===
  console.log('🔍 Checking if work item already exists...');
  let workItem = await find(vm);

  // Handle errors
  if (workItem === -1) {
    console.error('❌ Error during work item lookup');
    core.setFailed('Work item lookup failed');
    return;
  }

  // Create work item if it doesn't exist
  if (workItem === null) {
    console.log('➕ No work item found, creating new one...');
    
    // Determine work item type
    const workItemType = stateMapper.getWorkItemType(vm.title, vm.labels || []);
    vm.env.wit = workItemType;
    
    console.log(`📋 Work item type: ${workItemType}`);

    // Create the work item with full metadata
    workItem = await createWorkItem(vm, projectInfo, stateMapper, userMapper);

    if (workItem === -1) {
      console.error('❌ Error creating work item');
      core.setFailed('Work item creation failed');
      return;
    }

    // Link issue to work item with AB# syntax
    if (vm.env.ghToken) {
      console.log('🔗 Linking issue to work item with AB# syntax...');
      await updateIssueBody(vm, workItem);
    }
  } else {
    console.log(`✓ Found existing work item: ${workItem.id}`);
  }

  // === HANDLE SPECIFIC ACTIONS ===
  if (vm.action) {
    console.log(`⚙️  Processing action: ${vm.action}`);
    await handleAction(vm, workItem, projectInfo, stateMapper, userMapper);
  }

  // Final log
  if (workItem) {
    console.log(`✅ Work item ${workItem.id} processed successfully`);
  }
}

/**
 * Handle bulk migration
 * Fetches all issues from repository and syncs them
 */
async function handleBulkMigration(env) {
  console.log('📦 Starting bulk migration...');

  if (!env.github_token) {
    throw new Error('GitHub token required for bulk migration');
  }

  // Initialize Octokit
  const octokit = new Octokit({ auth: env.github_token });

  // Parse repository info from environment or config
  const owner = env.GITHUB_REPOSITORY_OWNER || env.ado_organization;
  const repo = env.GITHUB_REPOSITORY_NAME || env.ado_project;

  if (!owner || !repo) {
    throw new Error('Repository owner and name required. Set GITHUB_REPOSITORY_OWNER and GITHUB_REPOSITORY_NAME');
  }

  console.log(`📂 Repository: ${owner}/${repo}`);

  // Determine which issues to fetch based on mode
  const mode = env.MIGRATION_MODE || 'bulk_all';
  let state = 'all';
  
  if (mode === 'bulk_open') {
    state = 'open';
  } else if (mode === 'bulk_closed') {
    state = 'closed';
  }

  console.log(`📋 Fetching ${state} issues...`);

  // Fetch all issues (paginated)
  const issues = [];
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      const response = await octokit.issues.listForRepo({
        owner,
        repo,
        state,
        per_page: perPage,
        page,
      });

      if (response.data.length === 0) break;

      // Filter out pull requests (they have pull_request property)
      const onlyIssues = response.data.filter(issue => !issue.pull_request);
      issues.push(...onlyIssues);

      console.log(`  Fetched page ${page}: ${onlyIssues.length} issues`);

      if (response.data.length < perPage) break;
      page++;

      // Rate limiting
      await delay(config.rateLimiting.delayBetweenCalls);
    }
  } catch (error) {
    console.error('Error fetching issues:', error.message);
    throw error;
  }

  console.log(`📊 Total issues to migrate: ${issues.length}`);

  // Initialize utilities
  const stateMapper = initializeStateMapper(env);
  const userMapper = initializeUserMapper(env);
  const projectsClient = config.features.syncProjectStatus ? new GitHubProjectsClient(env.github_token) : null;

  // Process issues in batches
  const batchSize = config.rateLimiting.batchSize;
  let successCount = 0;
  let failCount = 0;
  const failedIssues = [];

  for (let i = 0; i < issues.length; i += batchSize) {
    const batch = issues.slice(i, i + batchSize);
    console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(issues.length / batchSize)}...`);

    for (const issue of batch) {
      try {
        console.log(`\n  📝 Issue #${issue.number}: ${issue.title.substring(0, 50)}...`);
        
        // Convert issue to vm format
        const vm = convertIssueToVm(issue, owner, repo, env);

        // Fetch project info if enabled
        let projectInfo = null;
        if (projectsClient) {
          projectInfo = await projectsClient.getIssueProjectInfo(owner, repo, issue.number);
        }

        // Check if work item exists
        let workItem = await find(vm);

        if (workItem === null || workItem === -1) {
          // Determine work item type
          const workItemType = stateMapper.getWorkItemType(vm.title, vm.labels || []);
          vm.env.wit = workItemType;

          // Create work item
          workItem = await createWorkItem(vm, projectInfo, stateMapper, userMapper);

          if (workItem && workItem !== -1) {
            // Link back to GitHub
            if (vm.env.ghToken) {
              await updateIssueBody(vm, workItem);
            }
            successCount++;
            console.log(`    ✅ Created work item ${workItem.id}`);
          } else {
            failCount++;
            failedIssues.push({ number: issue.number, title: issue.title, error: 'Creation failed' });
            console.error(`    ❌ Failed to create work item`);
          }
        } else {
          // Update existing work item
          await updateWorkItem(vm, workItem, projectInfo, stateMapper, userMapper);
          successCount++;
          console.log(`    ✅ Updated work item ${workItem.id}`);
        }

        // Rate limiting between issues
        await delay(config.rateLimiting.delayBetweenCalls);

      } catch (error) {
        failCount++;
        failedIssues.push({ number: issue.number, title: issue.title, error: error.message });
        console.error(`    ❌ Error processing issue #${issue.number}:`, error.message);

        if (!config.errorHandling.continueOnError) {
          throw error;
        }
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 BULK MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📋 Total: ${issues.length}`);

  if (failedIssues.length > 0) {
    console.log('\n❌ Failed Issues:');
    failedIssues.forEach(issue => {
      console.log(`  #${issue.number}: ${issue.title.substring(0, 40)}... - ${issue.error}`);
    });

    // Log to file if configured
    if (config.errorHandling.logFailures) {
      const fs = require('fs');
      fs.writeFileSync(
        config.errorHandling.failureLogPath,
        JSON.stringify(failedIssues, null, 2)
      );
      console.log(`\n📄 Failed issues logged to: ${config.errorHandling.failureLogPath}`);
    }
  }

  console.log('='.repeat(60));
}

/**
 * Create a new work item with full metadata sync
 * This is the core function that creates work items with all GitHub issue data
 */
async function createWorkItem(vm, projectInfo, stateMapper, userMapper) {
  if (config.logging.level >= 200) console.log('Creating work item with full metadata...');

  // === CONVERT MARKDOWN TO HTML ===
  const converter = new showdown.Converter({ tables: true });
  const descriptionHtml = converter.makeHtml(vm.body);

  // === DETERMINE ADO STATE ===
  const projectName = projectInfo ? projectsClient.getProjectName(projectInfo) : null;
  const projectStatus = projectInfo ? projectsClient.getProjectStatus(projectInfo) : null;
  
  const adoState = stateMapper.getAdoState(
    vm.env.wit,
    vm.state,
    projectName,
    projectStatus
  );

  console.log(`🎯 ADO State: ${adoState}`);

  // === MAP ASSIGNEE ===
  let assignedTo = null;
  if (config.features.syncAssignees && vm.assignees && vm.assignees.length > 0) {
    assignedTo = userMapper.getPrimaryAdoUser(vm.assignees);
    if (assignedTo) {
      console.log(`👤 Assigned to: ${assignedTo}`);
    }
  }

  // === BUILD PATCH DOCUMENT ===
  let patchDocument = [];

  // Title (required)
  if (config.features.syncTitle) {
    patchDocument.push({
      op: "add",
      path: "/fields/System.Title",
      value: `${vm.title} (GitHub Issue #${vm.number})`
    });
  }

  // Description (required for most work item types)
  if (config.features.syncDescription) {
    patchDocument.push({
      op: "add",
      path: "/fields/System.Description",
      value: descriptionHtml
    });

    // Also add to ReproSteps for Bugs
    if (vm.env.wit === "Bug") {
      patchDocument.push({
        op: "add",
        path: "/fields/Microsoft.VSTS.TCM.ReproSteps",
        value: descriptionHtml
      });
    }
  }

  // State
  if (config.features.syncState) {
    patchDocument.push({
      op: "add",
      path: "/fields/System.State",
      value: adoState
    });
  }

  // Tags - Include repo name and labels
  if (config.features.syncLabels) {
    const tags = buildTagsString(vm);
    patchDocument.push({
      op: "add",
      path: "/fields/System.Tags",
      value: tags
    });
  }

  // Hyperlink back to GitHub
  patchDocument.push({
    op: "add",
    path: "/relations/-",
    value: {
      rel: "Hyperlink",
      url: vm.url
    }
  });

  // History/Comment about creation
  patchDocument.push({
    op: "add",
    path: "/fields/System.History",
    value: `GitHub <a href="${vm.url}" target="_new">issue #${vm.number}</a> created in <a href="${vm.repo_url}" target="_new">${vm.repo_fullname}</a> by ${vm.user}`
  });

  // === AREA PATH ===
  const areaPath = stateMapper.getAreaPath(projectName);
  if (areaPath) {
    patchDocument.push({
      op: "add",
      path: "/fields/System.AreaPath",
      value: areaPath
    });
  }

  // === ITERATION PATH ===
  if (config.features.syncIterations && projectInfo) {
    const iterationPath = await handleIteration(vm, projectInfo, stateMapper);
    if (iterationPath) {
      patchDocument.push({
        op: "add",
        path: "/fields/System.IterationPath",
        value: iterationPath
      });
    }
  }

  // === ASSIGNEE ===
  if (config.features.syncAssignees && assignedTo) {
    patchDocument.push({
      op: "add",
      path: "/fields/System.AssignedTo",
      value: assignedTo
    });
  }

  // === DATES (requires bypassRules) ===
  if (config.features.syncDates && vm.env.bypassRules) {
    // Created date
    patchDocument.push({
      op: "add",
      path: "/fields/System.CreatedDate",
      value: vm.created_at
    });

    // Closed date if applicable
    if (vm.closed_at) {
      patchDocument.push({
        op: "add",
        path: "/fields/System.ClosedDate",
        value: vm.closed_at
      });
    }

    // Created by
    patchDocument.push({
      op: "add",
      path: "/fields/System.CreatedBy",
      value: vm.user
    });
  }

  // === CUSTOM FIELDS MAPPING ===
  if (projectInfo && projectInfo.fields) {
    const customFieldPatches = mapCustomFields(vm, projectInfo, vm.env.wit);
    patchDocument.push(...customFieldPatches);
  }

  // === PRIORITY FROM LABELS ===
  const priority = getPriorityFromLabels(vm.labels || []);
  if (priority) {
    patchDocument.push({
      op: "add",
      path: "/fields/Microsoft.VSTS.Common.Priority",
      value: priority
    });
  }

  // === STORY POINTS / EFFORT ===
  if (vm.defaultStoryPoints) {
    patchDocument.push({
      op: "add",
      path: "/fields/Microsoft.VSTS.Scheduling.StoryPoints",
      value: parseFloat(vm.defaultStoryPoints)
    });
  }

  // === HIERARCHY (PARENT-CHILD) ===
  if (config.features.syncHierarchy && vm.parent_id) {
    patchDocument.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: config.hierarchy.linkType,
        url: `https://dev.azure.com/${vm.env.organization}/${vm.env.project}/_apis/wit/workitems/${vm.parent_id}`
      }
    });
  }

  // Log patch document if verbose
  if (config.logging.level >= 300) {
    console.log("Patch document:");
    console.log(JSON.stringify(patchDocument, null, 2));
  }

  // === CREATE WORK ITEM ===
  const workItem = await executeWorkItemCreate(patchDocument, vm.env);
  
  // === SYNC COMMENTS ===
  if (workItem && config.features.syncComments && vm.comments && vm.comments.length > 0) {
    await syncComments(workItem.id, vm.comments, vm.env);
  }

  // === ADD CUSTOM FIELDS AS COMMENT ===
  if (workItem && config.customFields.writeToComments && projectInfo) {
    const customFieldsComment = projectsClient.formatCustomFieldsComment(projectInfo);
    if (customFieldsComment) {
      await addComment(workItem.id, customFieldsComment, vm.env);
    }
  }

  return workItem;
}

/**
 * Build tags string from labels and repo name
 */
function buildTagsString(vm) {
  const tags = [];

  // Add repo identifier
  tags.push("GitHub Issue");
  tags.push(vm.repo_name);
  
  // Add issue number tag
  tags.push(`GH-${vm.number}`);

  // Add all labels if configured
  if (config.labels.allAsTags && vm.labels && Array.isArray(vm.labels)) {
    vm.labels.forEach(label => {
      // Skip labels that map to priority (they're handled separately)
      if (!config.labels.priorityLabels[label]) {
        tags.push(label);
      }
    });
  }

  // Join with semicolon and space
  return tags.join("; ");
}

/**
 * Get priority value from labels
 */
function getPriorityFromLabels(labels) {
  if (!labels || !Array.isArray(labels)) return null;

  for (const label of labels) {
    if (config.labels.priorityLabels[label]) {
      return config.labels.priorityLabels[label];
    }
  }

  return null;
}

/**
 * Map custom fields from GitHub Projects to ADO fields
 */
function mapCustomFields(vm, projectInfo, workItemType) {
  const patches = [];

  if (!projectInfo || !projectInfo.fields) return patches;

  // Iterate through custom field mappings
  for (const [fieldName, mapping] of Object.entries(config.customFields.mappings)) {
    const value = projectInfo.fields[fieldName];
    
    if (!value) continue; // Skip if field not present

    // Check if this field should only apply to certain work item types
    if (mapping.workItemTypes && !mapping.workItemTypes.includes(workItemType)) {
      continue;
    }

    // If there's an ADO field mapping
    if (mapping.adoField) {
      let mappedValue = value;

      // Apply value mapping if present
      if (mapping.mapping && mapping.mapping[value] !== undefined) {
        mappedValue = mapping.mapping[value];
      }

      patches.push({
        op: "add",
        path: `/fields/${mapping.adoField}`,
        value: mappedValue
      });

      console.log(`  📋 Mapped ${fieldName} → ${mapping.adoField}: ${mappedValue}`);
    }
  }

  return patches;
}

/**
 * Handle iteration/sprint creation and mapping
 */
async function handleIteration(vm, projectInfo, stateMapper) {
  const sprintInfo = projectsClient.getSprintInfo(projectInfo);
  
  if (!sprintInfo) return null;

  console.log(`📅 Sprint: ${sprintInfo.name}`);

  // Initialize iteration creator if not already done
  if (!vm.iterationCreator) {
    vm.iterationCreator = new IterationCreator(
      vm.env.adoToken,
      vm.env.organization,
      vm.env.project
    );
  }

  // Create iteration if it doesn't exist and auto-create is enabled
  if (config.iterations.autoCreate) {
    await vm.iterationCreator.createFromSprintInfo(sprintInfo, config.iterations.defaultDuration);
  }

  // Return iteration path
  return vm.iterationCreator.getIterationPath(sprintInfo.name);
}

/**
 * Sync all comments from GitHub issue to ADO work item
 */
async function syncComments(workItemId, comments, env) {
  if (!comments || comments.length === 0) return;

  console.log(`💬 Syncing ${comments.length} comments...`);

  for (const comment of comments) {
    try {
      const commentHtml = buildCommentHtml(comment);
      await addComment(workItemId, commentHtml, env);
      
      // Rate limiting
      await delay(200);
    } catch (error) {
      console.error(`Error syncing comment:`, error.message);
    }
  }
}

/**
 * Build formatted HTML for a comment
 */
function buildCommentHtml(comment) {
  const converter = new showdown.Converter({ tables: true });
  const bodyHtml = converter.makeHtml(comment.body || '');

  let html = '';
  
  if (config.comments.includeAuthor) {
    html += `<strong>@${comment.user?.login || 'unknown'}</strong>`;
  }

  if (config.comments.includeDate) {
    const date = new Date(comment.created_at).toLocaleString();
    html += ` <em>(${date})</em>`;
  }

  html += '<br/>' + bodyHtml;

  if (config.comments.includeLinkBack && comment.html_url) {
    html += `<br/><small><a href="${comment.html_url}" target="_blank">View on GitHub</a></small>`;
  }

  return html;
}

/**
 * Add a comment to a work item
 */
async function addComment(workItemId, commentText, env) {
  const patchDocument = [{
    op: "add",
    path: "/fields/System.History",
    value: commentText
  }];

  return await updateWorkItemDirect(patchDocument, workItemId, env);
}

/**
 * Handle specific GitHub actions (edited, closed, labeled, etc.)
 */
async function handleAction(vm, workItem, projectInfo, stateMapper, userMapper) {
  switch (vm.action) {
    case "opened":
      // Already handled in create
      break;

    case "edited":
      if (workItem) await updateWorkItem(vm, workItem, projectInfo, stateMapper, userMapper);
      break;

    case "created": // Comment added
      if (workItem && vm.comment_text) {
        const commentHtml = buildCommentHtml({
          body: vm.comment_text,
          user: { login: vm.user },
          created_at: new Date().toISOString(),
          html_url: vm.comment_url
        });
        await addComment(workItem.id, commentHtml, vm.env);
      }
      break;

    case "closed":
      if (workItem) await closeWorkItem(vm, workItem, projectInfo, stateMapper);
      break;

    case "reopened":
      if (workItem) await reopenWorkItem(vm, workItem, projectInfo, stateMapper);
      break;

    case "assigned":
    case "unassigned":
      if (workItem) await updateAssignee(vm, workItem, userMapper);
      break;

    case "labeled":
      if (workItem && vm.label) await addLabel(vm, workItem);
      break;

    case "unlabeled":
      if (workItem && vm.label) await removeLabel(vm, workItem);
      break;

    default:
      console.log(`ℹ️  Unhandled action: ${vm.action}`);
  }
}

/**
 * Update existing work item
 */
async function updateWorkItem(vm, workItem, projectInfo, stateMapper, userMapper) {
  console.log('🔄 Updating work item...');

  const patchDocument = [];
  const converter = new showdown.Converter({ tables: true });

  // Update title if changed
  if (config.features.syncTitle) {
    const newTitle = `${vm.title} (GitHub Issue #${vm.number})`;
    if (workItem.fields["System.Title"] !== newTitle) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.Title",
        value: newTitle
      });
    }
  }

  // Update description if changed
  if (config.features.syncDescription) {
    const descriptionHtml = converter.makeHtml(vm.body);
    patchDocument.push({
      op: "replace",
      path: "/fields/System.Description",
      value: descriptionHtml
    });
  }

  // Update state based on project status
  if (config.features.syncProjectStatus && projectInfo) {
    const projectName = projectsClient.getProjectName(projectInfo);
    const projectStatus = projectsClient.getProjectStatus(projectInfo);
    const adoState = stateMapper.getAdoState(workItem.fields["System.WorkItemType"], vm.state, projectName, projectStatus);
    
    if (workItem.fields["System.State"] !== adoState) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.State",
        value: adoState
      });
    }
  }

  // Add history entry
  patchDocument.push({
    op: "add",
    path: "/fields/System.History",
    value: `Issue updated on GitHub by ${vm.user}`
  });

  if (patchDocument.length > 0) {
    return await updateWorkItemDirect(patchDocument, workItem.id, vm.env);
  }

  return workItem;
}

/**
 * Close work item
 */
async function closeWorkItem(vm, workItem, projectInfo, stateMapper) {
  console.log('🔒 Closing work item...');

  const projectName = projectInfo ? projectsClient.getProjectName(projectInfo) : null;
  const closedState = stateMapper.getAdoState(
    workItem.fields["System.WorkItemType"],
    "closed",
    projectName,
    "In Production" // Assume production when closed
  );

  const patchDocument = [
    {
      op: "replace",
      path: "/fields/System.State",
      value: closedState
    },
    {
      op: "add",
      path: "/fields/System.History",
      value: `Issue closed on GitHub by ${vm.user}`
    }
  ];

  // Add closed date if configured
  if (config.features.syncDates && vm.closed_at && vm.env.bypassRules) {
    patchDocument.push({
      op: "add",
      path: "/fields/System.ClosedDate",
      value: vm.closed_at
    });
  }

  return await updateWorkItemDirect(patchDocument, workItem.id, vm.env);
}

/**
 * Reopen work item
 */
async function reopenWorkItem(vm, workItem, projectInfo, stateMapper) {
  console.log('🔓 Reopening work item...');

  const projectName = projectInfo ? projectsClient.getProjectName(projectInfo) : null;
  const projectStatus = projectInfo ? projectsClient.getProjectStatus(projectInfo) : null;
  
  const reopenedState = stateMapper.getAdoState(
    workItem.fields["System.WorkItemType"],
    "open",
    projectName,
    projectStatus || "No status"
  );

  const patchDocument = [
    {
      op: "replace",
      path: "/fields/System.State",
      value: reopenedState
    },
    {
      op: "add",
      path: "/fields/System.History",
      value: `Issue reopened on GitHub by ${vm.user}`
    }
  ];

  return await updateWorkItemDirect(patchDocument, workItem.id, vm.env);
}

/**
 * Update assignee
 */
async function updateAssignee(vm, workItem, userMapper) {
  console.log('👤 Updating assignee...');

  const patchDocument = [];
  
  if (vm.assignees && vm.assignees.length > 0) {
    const assignedTo = userMapper.getPrimaryAdoUser(vm.assignees);
    if (assignedTo) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.AssignedTo",
        value: assignedTo
      });
    }
  } else {
    // Unassigned
    patchDocument.push({
      op: "remove",
      path: "/fields/System.AssignedTo"
    });
  }

  if (patchDocument.length > 0) {
    return await updateWorkItemDirect(patchDocument, workItem.id, vm.env);
  }

  return workItem;
}

/**
 * Add label (tag)
 */
async function addLabel(vm, workItem) {
  console.log(`🏷️  Adding label: ${vm.label}`);

  let currentTags = workItem.fields["System.Tags"] || "";
  
  // Check if label already exists
  if (currentTags.includes(vm.label)) {
    console.log('  Label already exists');
    return workItem;
  }

  // Add label
  if (currentTags) {
    currentTags += "; " + vm.label;
  } else {
    currentTags = vm.label;
  }

  const patchDocument = [{
    op: "replace",
    path: "/fields/System.Tags",
    value: currentTags
  }];

  return await updateWorkItemDirect(patchDocument, workItem.id, vm.env);
}

/**
 * Remove label (tag)
 */
async function removeLabel(vm, workItem) {
  console.log(`🏷️  Removing label: ${vm.label}`);

  let currentTags = workItem.fields["System.Tags"] || "";
  
  if (!currentTags.includes(vm.label)) {
    console.log('  Label not found');
    return workItem;
  }

  // Remove label
  currentTags = currentTags
    .split("; ")
    .filter(tag => tag !== vm.label)
    .join("; ");

  const patchDocument = [{
    op: "replace",
    path: "/fields/System.Tags",
    value: currentTags
  }];

  return await updateWorkItemDirect(patchDocument, workItem.id, vm.env);
}

/**
 * Find existing work item for a GitHub issue
 * Uses title and tags to locate the work item
 */
async function find(vm) {
  if (config.logging.level >= 200) console.log('Searching for existing work item...');

  let authHandler = azdev.getHandlerFromToken(vm.env.adoToken);
  let connection = new azdev.WebApi(vm.env.orgUrl, authHandler);
  let client = null;

  try {
    client = await connection.getWorkItemTrackingApi();
  } catch (error) {
    console.error('❌ Error connecting to Azure DevOps:', error.message);
    return -1;
  }

  const teamContext = { project: vm.env.project };

  // WIQL query to find work item
  const wiql = {
    query: `SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.Tags] 
            FROM workitems 
            WHERE [System.TeamProject] = @project 
            AND [System.Title] CONTAINS '(GitHub Issue #${vm.number})' 
            AND [System.Tags] CONTAINS 'GitHub Issue' 
            AND [System.Tags] CONTAINS '${vm.repository}'`
  };

  if (config.logging.level >= 300) {
    console.log('WIQL Query:');
    console.log(wiql.query);
  }

  try {
    const queryResult = await client.queryByWiql(wiql, teamContext);

    if (!queryResult || queryResult.workItems.length === 0) {
      console.log('  No existing work item found');
      return null;
    }

    const workItemRef = queryResult.workItems[0];
    const workItem = await client.getWorkItem(workItemRef.id, null, null, 4);

    console.log(`  Found work item: ${workItem.id}`);
    return workItem;

  } catch (error) {
    console.error('❌ Error querying work items:', error.message);
    return -1;
  }
}

/**
 * Execute work item creation
 */
async function executeWorkItemCreate(patchDocument, env) {
  if (config.logging.level >= 200) console.log('Executing work item creation...');

  let authHandler = azdev.getHandlerFromToken(env.adoToken);
  let connection = new azdev.WebApi(env.orgUrl, authHandler);
  let client = await connection.getWorkItemTrackingApi();

  try {
    const workItem = await client.createWorkItem(
      (customHeaders = []),
      (document = patchDocument),
      (project = env.project),
      (type = env.wit),
      (validateOnly = false),
      (bypassRules = env.bypassRules)
    );

    console.log(`✅ Work item created: ${workItem.id}`);
    
    if (config.logging.level >= 300) {
      console.log('Work item details:');
      console.log(JSON.stringify(workItem, null, 2));
    }

    return workItem;

  } catch (error) {
    console.error('❌ Error creating work item:', error.message);
    if (config.logging.level >= 300) {
      console.error('Patch document that failed:');
      console.error(JSON.stringify(patchDocument, null, 2));
    }
    return -1;
  }
}

/**
 * Update work item directly
 */
async function updateWorkItemDirect(patchDocument, workItemId, env) {
  if (config.logging.level >= 200) console.log(`Updating work item ${workItemId}...`);

  let authHandler = azdev.getHandlerFromToken(env.adoToken);
  let connection = new azdev.WebApi(env.orgUrl, authHandler);
  let client = await connection.getWorkItemTrackingApi();

  try {
    const workItem = await client.updateWorkItem(
      (customHeaders = []),
      (document = patchDocument),
      (id = workItemId),
      (project = env.project),
      (validateOnly = false),
      (bypassRules = env.bypassRules)
    );

    if (config.logging.level >= 300) {
      console.log('Updated work item:');
      console.log(JSON.stringify(workItem, null, 2));
    }

    return workItem;

  } catch (error) {
    console.error('❌ Error updating work item:', error.message);
    if (config.logging.level >= 300) {
      console.error('Patch document that failed:');
      console.error(JSON.stringify(patchDocument, null, 2));
    }
    return null;
  }
}

/**
 * Update GitHub issue body to include AB# link
 */
async function updateIssueBody(vm, workItem) {
  if (config.logging.level >= 200) console.log('Adding AB# link to GitHub issue...');

  // Check if AB# already exists
  if (vm.body.includes(`AB#${workItem.id}`)) {
    console.log('  AB# link already exists');
    return null;
  }

  try {
    const octokit = new Octokit({ auth: vm.env.ghToken });
    
    const updatedBody = vm.body + `\r\n\r\nAB#${workItem.id}`;

    const result = await octokit.issues.update({
      owner: vm.owner,
      repo: vm.repository,
      issue_number: vm.number,
      body: updatedBody
    });

    console.log('  ✅ Added AB# link to issue');
    return result;

  } catch (error) {
    console.error('❌ Error updating issue body:', error.message);
    return null;
  }
}

/**
 * Get values from GitHub payload
 * Parses the webhook payload into a usable object
 */
function getValuesFromPayload(payload, env) {
  const vm = {
    action: payload.action || "",
    url: payload.issue?.html_url || "",
    number: payload.issue?.number || -1,
    title: payload.issue?.title || "",
    state: payload.issue?.state || "",
    user: payload.issue?.user?.login || "",
    body: payload.issue?.body || "",
    repo_fullname: payload.repository?.full_name || "",
    repo_name: payload.repository?.name || "",
    repo_url: payload.repository?.html_url || "",
    closed_at: payload.issue?.closed_at || null,
    created_at: payload.issue?.created_at || null,
    updated_at: payload.issue?.updated_at || null,
    owner: payload.repository?.owner?.login || "",
    sender_login: payload.sender?.login || "",
    assignees: (payload.issue?.assignees || []).map(a => a.login),
    labels: (payload.issue?.labels || []).map(l => l.name),
    comments: payload.issue?.comments || [],
    defaultStoryPoints: env.defaultStoryPoints || 0.5,
    label: "",
    comment_text: "",
    comment_url: "",
    organization: "",
    repository: "",
    parent_id: env.ado_parent_id || null,
    env: buildEnvObject(env)
  };

  // Label (if this is a label event)
  if (payload.label) {
    vm.label = payload.label.name || "";
  }

  // Comment (if this is a comment event)
  if (payload.comment) {
    vm.comment_text = payload.comment.body || "";
    vm.comment_url = payload.comment.html_url || "";
  }

  // Split repo full name
  if (vm.repo_fullname) {
    const split = vm.repo_fullname.split("/");
    vm.organization = split[0] || "";
    vm.repository = split[1] || "";
  }

  if (config.logging.level >= 300) {
    console.log('Payload VM:');
    console.log(JSON.stringify(vm, null, 2));
  }

  return vm;
}

/**
 * Convert GitHub issue object to VM format (for bulk migration)
 */
function convertIssueToVm(issue, owner, repo, env) {
  return {
    action: "opened", // Default action for bulk migration
    url: issue.html_url,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    user: issue.user.login,
    body: issue.body || "",
    repo_fullname: `${owner}/${repo}`,
    repo_name: repo,
    repo_url: `https://github.com/${owner}/${repo}`,
    closed_at: issue.closed_at,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    owner: owner,
    sender_login: issue.user.login,
    assignees: (issue.assignees || []).map(a => a.login),
    labels: (issue.labels || []).map(l => l.name),
    comments: [], // Will be fetched separately if needed
    defaultStoryPoints: env.defaultStoryPoints || 0.5,
    label: "",
    comment_text: "",
    comment_url: "",
    organization: owner,
    repository: repo,
    parent_id: null,
    env: buildEnvObject(env)
  };
}

/**
 * Build environment object
 */
function buildEnvObject(env) {
  return {
    organization: env.ado_organization || "",
    orgUrl: env.ado_organization ? `https://dev.azure.com/${env.ado_organization}` : "",
    adoToken: env.ado_token || "",
    ghToken: env.github_token || "",
    project: env.ado_project || "",
    areaPath: env.ado_area_path || "",
    iterationPath: env.ado_iteration_path || "",
    wit: env.ado_wit || "Product Backlog Item",
    closedState: env.ado_close_state || "Done",
    newState: env.ado_new_state || "New",
    activeState: env.ado_active_state || "Active",
    bypassRules: env.ado_bypassrules === "true" || env.ado_bypassrules === true,
    logLevel: parseInt(env.log_level || "200"),
    assignedTo: env.ado_assigned_to || "",
    parentID: env.ado_parent_id || ""
  };
}

/**
 * Initialize State Mapper
 */
function initializeStateMapper(env) {
  const configPath = env.STATE_MAPPING_CONFIG || './Github_To_ADO_state_to_state_mapping.json';
  const mapper = new StateMapper(configPath);
  mapper.logConfig(config.logging.level);
  return mapper;
}

/**
 * Initialize User Mapper
 */
function initializeUserMapper(env) {
  const mapper = new UserMapper();
  
  // Load from environment variable (DEVELOPER_USERNAMES secret)
  if (env.DEVELOPER_USERNAMES) {
    mapper.loadFromJsonString(env.DEVELOPER_USERNAMES);
  }
  
  // Or load from file if path provided
  if (env.USER_MAPPING_FILE) {
    mapper.loadMappingData(env.USER_MAPPING_FILE);
  }

  mapper.logMappings(config.logging.level);
  return mapper;
}

/**
 * Delay helper for rate limiting
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    main,
    handleSingleIssue,
    handleBulkMigration,
    createWorkItem,
    updateWorkItem,
    find,
    buildTagsString,
    getPriorityFromLabels,
    mapCustomFields
  };
}

