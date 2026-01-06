const axios = require("axios");
const https = require("https");
const config = require("../config/config");

// Apply fabric token
async function applyFabricToken() {
  try {
    const response = await axios.post(
      `${config.baseUrl}/payment/v1/token`,
      {
        appSecret: config.appSecret,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-APP-Key": config.fabricAppId,
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
      }
    );

    // Assuming your response is a JSON object, no need to parse it
    return response.data;
  } catch (error) {
    console.error("Error while applying fabric token:", error.message);
    throw error; // Propagate the error for handling at a higher level
  }
}

module.exports = applyFabricToken;
