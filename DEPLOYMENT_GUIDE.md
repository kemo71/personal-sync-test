# Complete Deployment Guide
## GitHub to Azure DevOps Enhanced Migration

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [File Structure](#file-structure)
3. [Azure DevOps Setup](#azure-devops-setup)
4. [GitHub Setup](#github-setup)
5. [Configuration](#configuration)
6. [Testing](#testing)
7. [Bulk Migration](#bulk-migration)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts & Access
- ✅ GitHub repository with admin access
- ✅ Azure DevOps organization/project with permissions to:
  - Create work items
  - Create iterations/sprints
  - Configure team settings
- ✅ Ability to create Personal Access Tokens in both platforms

### Required Software (for local testing)
- Node.js 18+ 
- npm or yarn
- Git

---

## File Structure

Your repository should have these files:

```
your-repo/
├── .github/
│   └── workflows/
│       └── sync-enhanced.yml          # GitHub Action workflow
├── config.js                           # Feature flags & settings
├── stateMapper.js                      # State mapping utility
├── userMapper.js                       # User mapping utility
├── githubProjects.js                   # GitHub Projects API client
├── iterationCreator.js                 # Iteration creation utility
├── index-enhanced.js                   # Main script
├── package.json                        # Dependencies
├── Github_To_ADO_state_to_state_mapping.json  # State configuration
└── user_mapping.json (optional)        # User mappings (or use secret)
```

---

## Azure DevOps Setup

### Step 1: Create Personal Access Token

1. Go to: `https://dev.azure.com/YOUR_ORG/_usersSettings/tokens`
2. Click "New Token"
3. Configure:
   - **Name**: GitHub Migration Token
   - **Organization**: Your organization
   - **Expiration**: 90 days (or custom)
   - **Scopes**: 
     - ✅ Work Items: Read & Write
     - ✅ Project and Team: Read
4. Copy the token immediately (you won't see it again!)

### Step 2: Create Project (if needed)

1. Go to Azure DevOps
2. Create new project: "siwar" (or your project name)
3. Choose Scrum process template
4. Set visibility (Private/Public)

### Step 3: Create Area Paths

1. Go to Project Settings → Project configuration
2. Navigate to Areas tab
3. Create your area structure:
   ```
   siwar
   └── siwar Team
   ```

### Step 4: Create Iterations (Optional - can be automated)

**Option A: Manual Creation**
1. Go to Project Settings → Project configuration  
2. Navigate to Iterations tab
3. Create sprints with dates:
   - Sprint 68 (Oct 13 - Oct 26)
   - Sprint 69 (Oct 27 - Nov 9)
   - etc.

**Option B: Automatic Creation**
- Set `config.iterations.autoCreate = true` in config.js
- Iterations will be created during migration

### Step 5: Add Team Members

1. Go to Project Settings → Teams → Your team
2. Add all ADO users who will be assigned work items
3. Ensure emails match those in user mapping

---

## GitHub Setup

### Step 1: Create Personal Access Token

1. Go to: `https://github.com/settings/tokens`
2. Click "Generate new token (classic)"
3. Configure:
   - **Note**: ADO Migration Token
   - **Expiration**: 90 days
   - **Scopes**:
     - ✅ repo (full control)
     - ✅ workflow (if modifying workflows)
4. Copy the token

### Step 2: Add Secrets to Repository

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add these secrets:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `AZDO_WORK_ITEM_TOKEN` | (Azure DevOps PAT) | From Step 1 above |
| `GH_REPO_TOKEN` | (GitHub PAT) | From previous step |
| `DEVELOPER_USERNAMES` | (JSON array) | User mappings (see below) |

**DEVELOPER_USERNAMES Format:**
```json
[
  ["github_user1", "user1@company.com"],
  ["github_user2", "user2@company.com"],
  ["abdelrahman-haridy01", "aharidy@ksaa.gov.sa"]
]
```

Copy your user mappings from the Excel file into this format.

### Step 3: Copy Files to Repository

1. Clone your repository:
   ```bash
   git clone https://github.com/YOUR_ORG/YOUR_REPO.git
   cd YOUR_REPO
   ```

2. Copy all JavaScript files:
   ```bash
   # Copy the files you received
   cp /path/to/config.js ./
   cp /path/to/stateMapper.js ./
   cp /path/to/userMapper.js ./
   cp /path/to/githubProjects.js ./
   cp /path/to/iterationCreator.js ./
   cp /path/to/index-enhanced.js ./
   cp /path/to/package.json ./
   cp /path/to/Github_To_ADO_state_to_state_mapping.json ./
   ```

3. Copy workflow file:
   ```bash
   mkdir -p .github/workflows
   cp /path/to/workflow-enhanced.yml .github/workflows/sync-enhanced.yml
   ```

4. Commit and push:
   ```bash
   git add .
   git commit -m "Add enhanced GitHub to ADO migration"
   git push
   ```

---

## Configuration

### Step 1: Update Workflow YAML

Edit `.github/workflows/sync-enhanced.yml`:

```yaml
ado_organization: "your-ado-org"        # ← UPDATE THIS
ado_project: "siwar"                     # ← UPDATE THIS  
ado_area_path: "سوار\\سوار Team"        # ← UPDATE THIS
```

### Step 2: Configure Feature Flags

Edit `config.js` to enable/disable features:

```javascript
features: {
  syncTitle: true,              // ← Core feature
  syncDescription: true,        // ← Core feature
  syncState: true,              // ← Core feature
  syncAssignees: true,          // ← Enable if user mapping ready
  syncLabels: true,             // ← Enable for tags
  syncComments: true,           // ← Enable if you want comments
  syncDates: true,              // ← Enable for date preservation
  syncHierarchy: true,          // ← Enable for parent/child
  syncProjectStatus: true,      // ← Enable for GitHub Projects
  syncPullRequests: false,      // ← Enable later if needed
  syncMilestones: false,        // ← Keep disabled per requirements
  syncIterations: true,         // ← Enable for sprint mapping
  syncCustomFields: false,      // ← Keep false (write to comments)
  syncDevelopmentLinks: true,   // ← Enable for commit links
  syncReviewers: true,          // ← Enable for PR reviewers
  createIterations: true,       // ← Enable for auto-creation
}
```

### Step 3: Verify State Mapping

Your `Github_To_ADO_state_to_state_mapping.json` should have the correct project configurations. Verify:

```json
{
  "defaultProject": "siwar",
  "projects": {
    "siwar": {
      "name": "siwar",
      "adoAreaPath": "سوار\\سوار Team",
      "statusMappings": {
        // ... your mappings
      }
    }
  }
}
```

---

## Testing

### Phase 1: Single Issue Test (CRITICAL)

**DO THIS FIRST before any bulk migration!**

1. Create a test issue in GitHub:
   ```
   Title: [Bug] Test Issue for ADO Migration
   Body: This is a test issue to verify the migration works.
   Labels: bug, test
   Assignee: (assign to someone in your mapping)
   ```

2. The workflow should trigger automatically

3. Check GitHub Actions:
   - Go to Actions tab
   - Find the running workflow
   - Check logs for errors

4. Verify in Azure DevOps:
   - Work item created?
   - Title correct?
   - Description present?
   - State correct?
   - Tags include labels?
   - Assignee set?
   - Link back to GitHub?

5. Check GitHub issue:
   - Does it have "AB#12345" at the bottom?

**If everything works, proceed to Phase 2.**
**If something fails, check Troubleshooting section below.**

### Phase 2: Manual Bulk Test (10 Issues)

1. Go to GitHub → Actions tab
2. Select "Sync GH issue to Azure DevOps work item (Enhanced)"
3. Click "Run workflow"
4. Select:
   - Migration mode: `bulk_open`
   - Test mode: `false`
5. Click "Run workflow"

This will migrate your first batch of open issues.

6. Monitor the workflow run
7. Check Azure DevOps:
   - All work items created?
   - Fields populated correctly?
   - Tags correct?
   - States mapped properly?

8. Review logs:
   - Any errors?
   - Success/fail count?
   - Check `/tmp/failed_issues.json` if issues failed

**If 10 issues work well, proceed to Phase 3.**

### Phase 3: Full Bulk Migration

1. Go to Actions → Run workflow
2. Select: `bulk_all`
3. Let it run (may take 30-60 minutes depending on issue count)
4. Monitor progress in logs
5. Review summary at end
6. Check failed issues log if any

---

## Bulk Migration

### Migration Modes

| Mode | Description | Use When |
|------|-------------|----------|
| `single` | Event-driven (automatic) | Normal operation after setup |
| `bulk_open` | Migrate only open issues | Testing or incremental migration |
| `bulk_closed` | Migrate only closed issues | After open issues are done |
| `bulk_all` | Migrate all issues | Full migration |

### Rate Limiting

The script includes built-in rate limiting:
- Delay between issues: 500ms (configurable)
- Batch size: 10 issues (configurable)
- Max concurrent: 3 (configurable)

Adjust in `config.js`:
```javascript
rateLimiting: {
  delayBetweenCalls: 500,
  maxConcurrent: 3,
  batchSize: 10,
}
```

### Expected Duration

- 100 issues: ~10-15 minutes
- 500 issues: ~45-60 minutes  
- 1000 issues: ~2 hours

### Monitoring Progress

Watch the Actions log in real-time:
```
📦 Processing batch 1/50...
  📝 Issue #45: Fix login bug...
    ✅ Created work item 12345
  📝 Issue #46: Add new feature...
    ✅ Created work item 12346
...
```

---

## Troubleshooting

### Common Issues

#### 1. "401 Unauthorized" Error

**Cause:** Invalid Azure DevOps token

**Fix:**
1. Regenerate ADO PAT
2. Ensure scopes include "Work Items (Read, Write)"
3. Update `AZDO_WORK_ITEM_TOKEN` secret
4. Re-run workflow

#### 2. "Work Item Type 'X' does not exist"

**Cause:** Work item type mismatch

**Fix:**
1. Check your ADO project process template (Scrum, Agile, Basic)
2. Update work item type mappings in state mapping JSON
3. Common types:
   - Scrum: Epic, Product Backlog Item, Bug, Task
   - Agile: Epic, User Story, Bug, Task
   - Basic: Epic, Issue, Task

#### 3. "Area Path does not exist"

**Cause:** Area path not created in ADO

**Fix:**
1. Go to ADO Project Settings → Areas
2. Create the exact path from your config
3. Note: Arabic characters must match exactly

#### 4. "No ADO mapping found for GitHub user: X"

**Cause:** User not in DEVELOPER_USERNAMES secret

**Fix:**
1. Add user to the mapping:
   ```json
   [
     ...existing mappings...,
     ["new_github_user", "new_user@company.com"]
   ]
   ```
2. Update secret
3. Re-run for failed issues

#### 5. Dates Not Preserved

**Cause:** `bypassRules` not enabled

**Fix:**
1. Ensure `ado_bypassrules: true` in workflow
2. Check ADO token has sufficient permissions
3. Set `syncDates: true` in config.js

#### 6. Comments Not Syncing

**Cause:** Feature disabled or comments not fetched

**Fix:**
1. Set `syncComments: true` in config.js
2. For bulk migration, comments may need separate fetch
3. Check logs for comment sync status

#### 7. Iterations Not Created

**Cause:** Auto-creation disabled or parsing failed

**Fix:**
1. Set `createIterations: true` in config.js
2. Check sprint name format in GitHub Projects
3. Manually create iterations in ADO
4. Update iteration path in state mapping

#### 8. GitHub Projects Data Not Loading

**Cause:** Projects API access or wrong project IDs

**Fix:**
1. Verify GitHub PAT has Projects scope
2. Check project IDs in config.js
3. Confirm issues are in the specified projects
4. Check logs for GraphQL errors

### Debug Mode

Enable verbose logging:

1. Edit config.js:
   ```javascript
   logging: {
     level: 300,  // ← Change from 200 to 300
   }
   ```

2. Or in workflow:
   ```yaml
   log_level: 300
   ```

3. Re-run and check detailed logs

### Getting Help

If issues persist:

1. Check `/tmp/migration.log` (uploaded as artifact on failure)
2. Check `/tmp/failed_issues.json` for failed issues list
3. Review workflow logs in GitHub Actions
4. Verify all configuration files are correct
5. Test with a single simple issue first

---

## Post-Migration

### Verify Results

1. **Work Item Count:**
   - Compare GitHub issue count vs ADO work item count
   - Account for PRs (not migrated as issues)

2. **Spot Check:**
   - Random sample of 10-20 work items
   - Verify all fields populated correctly
   - Check links work (GitHub ↔ ADO)

3. **Hierarchy:**
   - Check parent-child relationships preserved
   - Verify epic → story → task structure

4. **Dates:**
   - Verify created dates match GitHub
   - Check closed dates for closed items

### Enable Ongoing Sync

After successful bulk migration, the workflow will automatically:
- Create work items for new issues
- Update work items when issues change
- Sync comments
- Update states
- Manage labels

No additional action needed!

### Area Path Updates (if needed)

If you need to change area paths after migration:

1. Export work items from ADO (CSV/Excel)
2. Update area path column in Excel
3. Re-import using Azure DevOps import tool
4. Or use ADO REST API to bulk update

---

## Advanced Topics

### Pull Request Syncing

To enable PR syncing:

1. Set `syncPullRequests: true` in config.js
2. Configure PR settings:
   ```javascript
   pullRequests: {
     enabled: true,
     createWorkItems: true,
     workItemType: "Task",
     linkToParentIssue: true,
   }
   ```
3. PRs will create separate work items linked to issues

### Custom Field Mapping

To map GitHub Projects custom fields to ADO:

1. Create custom fields in ADO first
2. Update config.js mappings:
   ```javascript
   customFields: {
     mappings: {
       "Your Custom Field": {
         adoField: "Custom.YourField",
         fallback: "comment"
       }
     }
   }
   ```

### Hierarchy Preservation

The script automatically preserves:
- Epic → Story relationships
- Story → Task relationships
- Blocked by / Depends on links

Verify by checking Relations tab in ADO work items.

---

## Maintenance

### Token Renewal

PATs expire! Set calendar reminders:
- 7 days before expiration: Create new token
- Update secrets in GitHub
- Test with a single issue

### Regular Updates

Check for updates to dependencies:
```bash
npm outdated
npm update
```

### Monitoring

Set up alerts for workflow failures:
1. GitHub → Settings → Notifications
2. Enable "Actions" notifications
3. Get notified of failures

---

## Summary Checklist

Before going live:

- [ ] ADO PAT created with correct scopes
- [ ] GitHub PAT created with repo scope
- [ ] All secrets added to GitHub
- [ ] All files copied to repository
- [ ] Workflow YAML updated with your settings
- [ ] config.js configured
- [ ] State mapping JSON in place
- [ ] User mappings complete
- [ ] Test issue successfully migrated
- [ ] 10-issue batch test passed
- [ ] Area paths created in ADO
- [ ] Team members added to ADO
- [ ] Backup of GitHub issues taken

Then proceed with bulk migration!

---

**Questions or Issues?** Check the troubleshooting section or review workflow logs.

