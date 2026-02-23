# Known Security Issues

## sqlite3 Build Dependencies (High Severity)

The sqlite3 package has vulnerabilities in its build-time dependencies (node-gyp, tar, minimatch). These only affect the installation process, not runtime security.

### Impact
- **Risk Level**: Low (build-time only)
- **Affected**: sqlite3 installation process
- **Runtime**: No runtime security impact

### Mitigation
- Use trusted npm registry
- Install in controlled environments
- Consider alternative: better-sqlite3 (pure JS, no native build)

### Status
Monitoring for sqlite3 updates that resolve build dependency issues.
