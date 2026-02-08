// Dynamic Expo config to inject file/env variables for EAS builds
require('dotenv').config()

module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || config.extra?.googleWebClientId

  return {
    ...config,
    android: {
      ...config.android,
      // Allow providing google-services.json as an EAS File variable
      googleServicesFile,
    },
    extra: {
      ...config.extra,
      googleWebClientId,
      eas: config.extra?.eas,
    },
  }
}
