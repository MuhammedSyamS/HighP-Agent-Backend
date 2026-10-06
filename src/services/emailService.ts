import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';

let transporter: Transporter | null = null;

function getTransporter() {
  const user = (config.email.user || '').trim();
  const pass = (config.email.pass || '').replace(/\s+/g, '');

  if (!user || !pass) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // Direct SSL port 465
      auth: { user, pass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000
    });
  }
  return transporter;
}

// HTTP-based delivery providers to bypass Render's outbound SMTP (ports 25, 465, 587) block on free tier
async function sendViaBrevo(apiKey: string, toEmail: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    const fromEmail = (config.email.user || 'highphaus@gmail.com').trim();
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey.trim(),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'HighP Monitor', email: fromEmail },
        to: [{ email: toEmail }],
        subject,
        htmlContent: html,
        textContent: text
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[EMAIL_SERVICE:BREVO] HTTP ${res.status}:`, err);
      return false;
    }
    const data: any = await res.json();
    console.log(`[EMAIL_SERVICE:BREVO] Email dispatched successfully (id: ${data.messageId || 'OK'})`);
    return true;
  } catch (err: any) {
    console.error('[EMAIL_SERVICE:BREVO] Request failed:', err.message);
    return false;
  }
}

async function sendViaResend(apiKey: string, toEmail: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    const fromAddress = process.env.RESEND_FROM || 'HighP Monitor <onboarding@resend.dev>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject,
        html,
        text
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[EMAIL_SERVICE:RESEND] HTTP ${res.status}:`, err);
      return false;
    }
    const data: any = await res.json();
    console.log(`[EMAIL_SERVICE:RESEND] Email dispatched successfully (id: ${data.id || 'OK'})`);
    return true;
  } catch (err: any) {
    console.error('[EMAIL_SERVICE:RESEND] Request failed:', err.message);
    return false;
  }
}

async function sendViaWebhook(webhookUrl: string, toEmail: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toEmail, subject, html, text })
    });
    if (!res.ok) {
      console.error(`[EMAIL_SERVICE:WEBHOOK] HTTP ${res.status}`);
      return false;
    }
    console.log('[EMAIL_SERVICE:WEBHOOK] Email dispatched via webhook relay');
    return true;
  } catch (err: any) {
    console.error('[EMAIL_SERVICE:WEBHOOK] Failed:', err.message);
    return false;
  }
}

export async function sendOtpEmail(
  toEmail: string,
  otp: string,
  purpose: 'LOGIN' | 'FORGOT_PASSWORD' | 'SIGNUP'
): Promise<boolean> {
  let subject = `[HighP Monitor] Sign In Verification Code: ${otp}`;
  let title = 'Sign In Verification Code';
  let message = 'Use the 6-digit verification code below to complete sign-in to your HighP workspace:';

  if (purpose === 'FORGOT_PASSWORD') {
    subject = `[HighP Monitor] Password Reset Code: ${otp}`;
    title = 'Password Recovery Code';
    message = 'We received a request to reset your password. Use the verification code below to authorize this change:';
  } else if (purpose === 'SIGNUP') {
    subject = `[HighP Monitor] Account Registration Code: ${otp}`;
    title = 'Verify Your Email to Complete Signup';
    message = 'Use the 6-digit verification code below to authorize and complete your new employee account registration:';
  }

  const text = `Your HighP verification code is: ${otp}. It will expire in 10 minutes.`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #0f172a;">
      <div style="display: flex; align-items: center; margin-bottom: 24px;">
        <div style="width: 36px; height: 36px; border-radius: 10px; background-color: #000000; color: #ffffff; font-size: 18px; line-height: 36px; text-align: center; font-weight: 900; margin-right: 12px;">⚡</div>
        <div>
          <h2 style="margin: 0; font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.3px;">HighP Monitor</h2>
          <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.5px;">Workforce Telemetry SaaS</p>
        </div>
      </div>
      
      <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 16px; margin-bottom: 8px;">
        ${title}
      </h3>
      <p style="font-size: 14px; color: #475569; line-height: 1.5; margin: 0 0 20px 0;">
        ${message}
      </p>

      <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
        <div style="font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #000000; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
          ${otp}
        </div>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #64748b; font-weight: 500;">
          Valid for 10 minutes &bull; Single-use security code
        </p>
      </div>

      <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 24px 0 0 0; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        If you did not request this email, no further action is required. Your account remains completely secure.
      </p>
    </div>
  `;

  // 1. Try Brevo HTTP API (Port 443 HTTPS - Works 100% on Render Free Tier)
  const brevoApiKey = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY;
  if (brevoApiKey) {
    const success = await sendViaBrevo(brevoApiKey, toEmail, subject, html, text);
    if (success) return true;
  }

  // 2. Try Resend HTTP API (Port 443 HTTPS - Works 100% on Render Free Tier)
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    const success = await sendViaResend(resendApiKey, toEmail, subject, html, text);
    if (success) return true;
  }

  // 3. Try Webhook relay if configured
  const webhookUrl = process.env.GMAIL_WEBHOOK_URL || process.env.EMAIL_WEBHOOK_URL;
  if (webhookUrl) {
    const success = await sendViaWebhook(webhookUrl, toEmail, subject, html, text);
    if (success) return true;
  }

  // 4. Fallback to Nodemailer SMTP (Works on localhost and paid cloud instances)
  const mailer = getTransporter();
  if (!mailer) {
    console.warn(`[EMAIL_SERVICE] No active email provider (Brevo/Resend/SMTP). Simulated OTP for ${toEmail}: ${otp}`);
    return false;
  }

  try {
    const info = await mailer.sendMail({
      from: config.email.from,
      to: toEmail,
      subject,
      text,
      html
    });
    console.log(`[EMAIL_SERVICE:SMTP] Real email dispatched to ${toEmail} (messageId: ${info.messageId})`);
    return true;
  } catch (error: any) {
    console.error(`[EMAIL_SERVICE:SMTP] Failed to send email to ${toEmail}:`, error.message);
    return false;
  }
}
