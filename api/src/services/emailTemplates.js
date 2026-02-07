/**
 * Email Templates
 * 
 * Pre-formatted HTML email templates for various notification types
 */

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ET', {
        style: 'currency',
        currency: 'ETB',
        minimumFractionDigits: 2,
    }).format(amount);
};

const baseTemplate = (content, title) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6; 
            color: #374151; 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px;
            background-color: #f3f4f6;
        }
        .container {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .header { 
            background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); 
            color: white; 
            padding: 30px; 
            text-align: center; 
        }
        .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
        .header p { margin: 8px 0 0; opacity: 0.9; }
        .content { 
            padding: 30px; 
        }
        .content h2 {
            color: #111827;
            font-size: 20px;
            margin-top: 0;
        }
        .highlight-box {
            background: #FEF3C7;
            border-left: 4px solid #F59E0B;
            padding: 16px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        .info-box {
            background: #DBEAFE;
            border-left: 4px solid #3B82F6;
            padding: 16px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        .button { 
            display: inline-block; 
            background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); 
            color: white; 
            padding: 14px 28px; 
            text-decoration: none; 
            border-radius: 8px; 
            margin-top: 24px;
            font-weight: 600;
        }
        .button:hover {
            opacity: 0.9;
        }
        .details-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .details-table td {
            padding: 12px;
            border-bottom: 1px solid #E5E7EB;
        }
        .details-table td:first-child {
            font-weight: 600;
            color: #6B7280;
            width: 40%;
        }
        .footer { 
            text-align: center; 
            padding: 20px 30px;
            background: #F9FAFB;
            border-top: 1px solid #E5E7EB;
        }
        .footer p { 
            margin: 0; 
            font-size: 13px; 
            color: #6B7280; 
        }
        .footer .small {
            font-size: 12px;
            margin-top: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🦞 MirachPOS</h1>
            <p>Point of Sale System</p>
        </div>
        <div class="content">
            ${content}
        </div>
        <div class="footer">
            <p>This is an automated message from MirachPOS.</p>
            <p class="small">Please do not reply to this email. For support, contact support@mirachpos.com</p>
        </div>
    </div>
</body>
</html>`;

const paymentReminderTemplate = ({ invoiceNumber, amount, dueDate, daysRemaining }) => {
    const urgency = daysRemaining <= 1 ? 'urgent' : daysRemaining <= 3 ? 'warning' : 'info';
    const urgencyColor = urgency === 'urgent' ? '#DC2626' : urgency === 'warning' ? '#F59E0B' : '#3B82F6';
    const urgencyText = urgency === 'urgent' ? 'URGENT' : urgency === 'warning' ? 'REMINDER' : 'HEADS UP';

    const content = `
        <h2>💳 Payment ${urgencyText}</h2>
        
        <div class="highlight-box" style="border-left-color: ${urgencyColor};">
            <strong>Your invoice ${invoiceNumber} for ${formatCurrency(amount)} is due ${daysRemaining === 0 ? 'TODAY' : `in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}`}.</strong>
        </div>
        
        <p>Hi there,</p>
        
        <p>This is a friendly reminder that payment for your MirachPOS subscription is due soon. To avoid any interruption to your service, please complete your payment as soon as possible.</p>
        
        <table class="details-table">
            <tr>
                <td>Invoice Number</td>
                <td>${invoiceNumber}</td>
            </tr>
            <tr>
                <td>Amount Due</td>
                <td><strong>${formatCurrency(amount)}</strong></td>
            </tr>
            <tr>
                <td>Due Date</td>
                <td>${new Date(dueDate).toLocaleDateString('en-ET', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
            </tr>
        </table>
        
        <div class="info-box">
            <strong>💡 Need help with payment?</strong><br>
            You can pay online via Chapa or Telebirr, or make a bank transfer. Visit your billing page for payment options.
        </div>
        
        <a href="${process.env.APP_URL || 'https://mirachpos.com'}/#/owner/billing" class="button">Pay Now</a>
    `;

    return baseTemplate(content, `Payment Reminder - Invoice ${invoiceNumber}`);
};

const overdueTemplate = ({ invoiceNumber, amount, dueDate, daysOverdue }) => {
    const content = `
        <h2 style="color: #DC2626;">⚠️ OVERDUE PAYMENT</h2>
        
        <div class="highlight-box" style="background: #FEE2E2; border-left-color: #DC2626;">
            <strong style="color: #DC2626;">Your invoice ${invoiceNumber} for ${formatCurrency(amount)} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue.</strong>
        </div>
        
        <p>Hi there,</p>
        
        <p>We noticed that payment for your MirachPOS subscription is now overdue. To avoid service suspension, please complete your payment immediately.</p>
        
        <table class="details-table">
            <tr>
                <td>Invoice Number</td>
                <td>${invoiceNumber}</td>
            </tr>
            <tr>
                <td>Amount Due</td>
                <td><strong style="color: #DC2626;">${formatCurrency(amount)}</strong></td>
            </tr>
            <tr>
                <td>Due Date</td>
                <td>${new Date(dueDate).toLocaleDateString('en-ET', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
            </tr>
            <tr>
                <td>Days Overdue</td>
                <td><span style="color: #DC2626; font-weight: 600;">${daysOverdue} day${daysOverdue > 1 ? 's' : ''}</span></td>
            </tr>
        </table>
        
        <p style="color: #DC2626; font-weight: 600;">⚠️ Important: Your account may be suspended if payment is not received within the grace period.</p>
        
        <a href="${process.env.APP_URL || 'https://mirachpos.com'}/#/owner/billing" class="button">Pay Now to Avoid Suspension</a>
    `;

    return baseTemplate(content, `OVERDUE - Invoice ${invoiceNumber}`);
};

const suspendedTemplate = ({ tenantName }) => {
    const content = `
        <h2 style="color: #DC2626;">⛔ Account Suspended</h2>
        
        <div class="highlight-box" style="background: #FEE2E2; border-left-color: #DC2626;">
            <strong style="color: #DC2626;">Your MirachPOS account has been suspended due to non-payment.</strong>
        </div>
        
        <p>Hi ${tenantName || 'there'},</p>
        
        <p>We regret to inform you that your MirachPOS account has been suspended due to overdue payment. Your POS system is currently not accessible.</p>
        
        <p>To restore your account:</p>
        <ol>
            <li>Log in to your account</li>
            <li>Complete the outstanding payment</li>
            <li>Your account will be reactivated automatically</li>
        </ol>
        
        <a href="${process.env.APP_URL || 'https://mirachpos.com'}/#/owner/billing" class="button">Restore My Account</a>
        
        <p style="margin-top: 24px; font-size: 14px; color: #6B7280;">Need assistance? Contact our support team at support@mirachpos.com</p>
    `;

    return baseTemplate(content, 'Account Suspended - Action Required');
};

const welcomeTemplate = ({ businessName, email, tempPassword, loginUrl }) => {
    const content = `
        <h2>🎉 Welcome to MirachPOS!</h2>
        
        <div class="info-box" style="background: #D1FAE5; border-left-color: #10B981;">
            <strong>Your workspace "${businessName}" has been created successfully!</strong>
        </div>
        
        <p>Hi there,</p>
        
        <p>Welcome to MirachPOS! We're excited to help you streamline your restaurant or cafe operations. Your 14-day free trial starts now.</p>
        
        <h3>🔐 Your Login Details</h3>
        <table class="details-table">
            <tr>
                <td>Email</td>
                <td>${email}</td>
            </tr>
            <tr>
                <td>Temporary Password</td>
                <td><code style="background: #F3F4F6; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${tempPassword}</code></td>
            </tr>
        </table>
        
        <div class="highlight-box">
            <strong>⚠️ Security Tip:</strong> Please change your password after your first login.
        </div>
        
        <a href="${loginUrl || process.env.APP_URL || 'https://mirachpos.com'}" class="button">Log In to Your Account</a>
        
        <h3 style="margin-top: 30px;">🚀 What's Next?</h3>
        <ul>
            <li>Set up your menu items</li>
            <li>Add your staff members</li>
            <li>Configure your printers</li>
            <li>Start taking orders!</li>
        </ul>
    `;

    return baseTemplate(content, 'Welcome to MirachPOS!');
};

module.exports = {
    paymentReminderTemplate,
    overdueTemplate,
    suspendedTemplate,
    welcomeTemplate,
    formatCurrency,
};
