/* FORGEDTITANIUM ACC-R011 administration CLI (local).
   node server/acc_admin.js issue-agent-key <verified agent code>
   node server/acc_admin.js issue-viewer-token <label>
   node server/acc_admin.js revoke <key_id | token_id>
   node server/acc_admin.js list
   node server/acc_admin.js verify-audit
   node server/acc_admin.js stats
   node server/acc_admin.js backup <directory>
   node server/acc_admin.js verify-backup <file.sqlite3>
   node server/acc_admin.js export-audit <file.jsonl>
   node server/acc_admin.js publish-status <file.json>   write the restricted public status document (no secrets, no task data)
   Uses ACC_DATA_DIR and ACC_KEYS_FILE. Secrets are printed once and never logged. */
'use strict';
const path = require('node:path');
const S = require('./acc_server.js');

function ctx() {
  const dataDir = process.env.ACC_DATA_DIR || path.join(process.cwd(), 'acc_data');
  const keysFile = process.env.ACC_KEYS_FILE || path.join(dataDir, 'acc_keys.json');
  return { db: S.openDb(dataDir), keysFile, now: () => Date.now() };
}

function main(argv) {
  const [cmd, arg] = argv;
  const c = ctx();
  try {
    switch (cmd) {
      case 'issue-agent-key': { const k = S.issueAgentKey(c, arg, 'admin-cli'); console.log(JSON.stringify(k, null, 2)); console.log('Store the secret in the agent host\u2019s secret store now. It is not shown again.'); break; }
      case 'issue-viewer-token': { const t = S.issueViewerToken(c, arg || 'dashboard', 'admin-cli'); console.log(JSON.stringify(t, null, 2)); console.log('Store the token now. Only its hash is kept.'); break; }
      case 'revoke': console.log('Revoked at ' + S.revoke(c, arg, 'admin-cli')); break;
      case 'list': { const k = S.readKeys(c.keysFile); console.log(JSON.stringify({ agent_keys: k.agent_keys.map(x => ({ key_id: x.key_id, agent_code: x.agent_code, created_at_utc: x.created_at_utc, revoked_at_utc: x.revoked_at_utc })), viewer_tokens: k.viewer_tokens.map(x => ({ token_id: x.token_id, label: x.label, created_at_utc: x.created_at_utc, revoked_at_utc: x.revoked_at_utc })) }, null, 2)); break; }
      case 'verify-audit': { const v = S.verifyAudit(c.db); console.log(JSON.stringify(v, null, 2)); process.exitCode = v.intact ? 0 : 1; break; }
      case 'stats': console.log(JSON.stringify(S.dbStats(c.db), null, 2)); break;
      case 'backup': { if (!arg) throw new Error('backup needs a directory'); const b = S.backupDb(c, arg, 'admin-cli'); console.log(JSON.stringify(b, null, 2)); break; }
      case 'verify-backup': { const v = S.verifyBackup(arg); console.log(JSON.stringify(v, null, 2)); process.exitCode = v.ok ? 0 : 1; break; }
      case 'export-audit': { if (!arg) throw new Error('export-audit needs a file'); console.log(JSON.stringify(S.exportAudit(c, arg, 'admin-cli'), null, 2)); break; }
      case 'publish-status': { if (!arg) throw new Error('publish-status needs a file'); const doc = S.publicStatusDoc(c.db, Date.now()); require('node:fs').writeFileSync(arg, JSON.stringify(doc, null, 2) + '\n'); console.log('Wrote ' + arg + ' (' + doc.agents.length + ' agents, generated ' + doc.generated_at_utc + ')'); break; }
      default: console.log('Commands: issue-agent-key <code> | issue-viewer-token <label> | revoke <id> | list | verify-audit | stats | backup <dir> | verify-backup <file> | export-audit <file> | publish-status <file>'); process.exitCode = 2;
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { c.db.close(); }
}
main(process.argv.slice(2));
