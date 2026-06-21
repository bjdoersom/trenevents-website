// TrenEvents — Daily email reminder script
// Runs via GitHub Actions every morning at 9 AM Eastern.
// Finds events happening tomorrow, emails users who set a reminder, marks them sent.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

// ── Setup ─────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const RESEND_API_KEY = process.env.RESEND_API_KEY;

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Helpers ───────────────────────────────────────────────────
function getTomorrowDateString() {
  const d = new Date();
  // Shift to Eastern time (UTC-4 in summer, UTC-5 in winter)
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() + 1);
  const yyyy = et.getFullYear();
  const mm = String(et.getMonth() + 1).padStart(2, '0');
  const dd = String(et.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function sendEmail(to, eventTitle, eventDate, eventTime, eventLocation, ctaUrl) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'TrenEvents <reminders@trenevents.com>',
      to: [to],
      subject: `Reminder: ${eventTitle} is tomorrow!`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a2e;">
          <div style="font-size: 1.5rem; font-weight: bold; color: #e07a5f; margin-bottom: 8px;">TrenEvents</div>
          <div style="height: 3px; background: linear-gradient(90deg, #e07a5f, #3d405b); border-radius: 2px; margin-bottom: 28px;"></div>

          <p style="font-size: 1rem; margin-bottom: 6px;">👋 Just a heads up —</p>
          <h1 style="font-size: 1.4rem; margin: 0 0 16px;">${eventTitle}</h1>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr>
              <td style="padding: 8px 0; color: #666; font-size: 0.9rem; width: 80px;">📅 Date</td>
              <td style="padding: 8px 0; font-size: 0.9rem;">${eventDate}</td>
            </tr>
            ${eventTime ? `<tr>
              <td style="padding: 8px 0; color: #666; font-size: 0.9rem;">🕐 Time</td>
              <td style="padding: 8px 0; font-size: 0.9rem;">${eventTime}</td>
            </tr>` : ''}
            ${eventLocation ? `<tr>
              <td style="padding: 8px 0; color: #666; font-size: 0.9rem;">📍 Where</td>
              <td style="padding: 8px 0; font-size: 0.9rem;">${eventLocation}</td>
            </tr>` : ''}
          </table>

          ${ctaUrl ? `<a href="${ctaUrl}" style="display: inline-block; background: #e07a5f; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 0.95rem; margin-bottom: 28px;">View Event Details →</a>` : ''}

          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
          <p style="font-size: 0.78rem; color: #999; margin: 0;">
            You're getting this because you saved this event on <a href="https://trenevents.com" style="color: #e07a5f;">TrenEvents</a> and turned on the reminder bell 🔔.<br>
            To stop reminders, visit your saved events and tap the bell again.
          </p>
        </div>
      `
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const testEmail = process.env.TEST_EMAIL?.trim();

  // ── Test mode: send a sample email to the provided address ──
  if (testEmail) {
    console.log(`TEST MODE — sending sample reminder to ${testEmail}`);
    await sendEmail(
      testEmail,
      'Long\'s Park Summer Music Series',
      'Sundays through August 23, 2026',
      '7:30 PM',
      'Long\'s Park Amphitheater, Lancaster, PA',
      'https://www.longspark.org/summer-music-series'
    );
    console.log('Test email sent! Check your inbox.');
    return;
  }

  // ── Normal daily run ─────────────────────────────────────────
  const tomorrow = getTomorrowDateString();
  console.log(`Checking for reminders with sortDate: ${tomorrow}`);

  const snap = await db.collection('reminders')
    .where('sortDate', '==', tomorrow)
    .where('sent', '==', false)
    .get();

  console.log(`Found ${snap.size} reminder(s) to send`);

  let sent = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const r = doc.data();
    try {
      await sendEmail(
        r.userEmail,
        r.eventTitle,
        r.eventDate,
        r.eventTime,
        r.eventLocation,
        r.ctaUrl
      );
      await doc.ref.update({ sent: true, sentAt: new Date().toISOString() });
      console.log(`✓ Sent to ${r.userEmail} for "${r.eventTitle}"`);
      sent++;
    } catch (err) {
      console.error(`✗ Failed for ${r.userEmail}:`, err.message);
      failed++;
    }
  }

  console.log(`Done. Sent: ${sent}, Failed: ${failed}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
