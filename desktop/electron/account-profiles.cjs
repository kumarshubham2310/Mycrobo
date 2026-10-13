// Compatibility entry point for older packaged references. The authoritative
// runtime is tenant-registry.cjs; no account has a primary or secondary role.
module.exports = require("./tenant-registry.cjs");
