// Sign Android release builds with your own keystore when one is configured, so sideloaded
// updates install over the previous version. Configure in ~/.gradle/gradle.properties
// (never commit these):
//
//   PERSONA_UPLOAD_STORE_FILE=/home/you/persona-release.keystore
//   PERSONA_UPLOAD_STORE_PASSWORD=...
//   PERSONA_UPLOAD_KEY_ALIAS=persona
//   PERSONA_UPLOAD_KEY_PASSWORD=...
//
// Without them, release builds fall back to the debug key (fine for trying the app, but you
// can't update an app signed with one key using an APK signed with another).
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// persona-release-signing";

const SIGNING = `
        release { ${MARK}
            if (project.hasProperty('PERSONA_UPLOAD_STORE_FILE')) {
                storeFile file(PERSONA_UPLOAD_STORE_FILE)
                storePassword PERSONA_UPLOAD_STORE_PASSWORD
                keyAlias PERSONA_UPLOAD_KEY_ALIAS
                keyPassword PERSONA_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    // 1. add a `release` signing config next to the template's `debug` one
    g = g.replace(/signingConfigs\s*\{/, (m) => `${m}${SIGNING}`);
    // 2. release build type: use it when configured, else keep the template's debug key
    g = g.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('PERSONA_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );
    cfg.modResults.contents = g;
    return cfg;
  });
};
