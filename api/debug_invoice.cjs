
const { db } = require('./src/db');

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const getInvoiceDetails = async (invoiceId) => {
    console.log(`Fetching invoice: ${invoiceId}`);
    try {
        const invoice = await db()
            .select(['*'])
            .from('invoices')
            .where({ id: invoiceId })
            .first();

        console.log('Invoice raw:', invoice ? 'Found' : 'Not Found');

        if (!invoice) return null;

        const payments = await db()
            .select(['*'])
            .from('payments')
            .where({ invoice_id: invoiceId })
            .orderBy('created_at', 'desc');

        console.log(`Payments found: ${payments.length}`);

        return {
            id: invoice.id,
            tenantId: invoice.tenant_id,
            invoiceNumber: invoice.invoice_number,
            type: invoice.type,
            status: invoice.status,
            lineItems: safeJsonParse(invoice.line_items_json, []),
            subtotalEtb: Number(invoice.subtotal_etb || 0),
            taxEtb: Number(invoice.tax_etb || 0),
            discountEtb: Number(invoice.discount_etb || 0),
            totalEtb: Number(invoice.total_etb || 0),
            currency: invoice.currency,
            issueDate: invoice.issue_date,
            dueDate: invoice.due_date,
            paidAt: invoice.paid_at,
            periodStart: invoice.period_start,
            periodEnd: invoice.period_end,
            notes: invoice.notes,
            metadata: safeJsonParse(invoice.metadata_json, {}),
            payments: payments.map((p) => ({
                id: p.id,
                method: p.method,
                status: p.status,
                amountEtb: Number(p.amount_etb || 0),
                reference: p.reference,
                proofUrl: p.proof_url,
                proofFilename: p.proof_filename,
                rejectionReason: p.rejection_reason,
                createdAt: p.created_at,
                verifiedAt: p.verified_at,
            })),
            createdAt: invoice.created_at,
            updatedAt: invoice.updated_at,
        };
    } catch (e) {
        console.error('Error in getInvoiceDetails:', e);
        throw e;
    }
};

// Run it
(async () => {
    try {
        const result = await getInvoiceDetails('inv_a9115f9dfcb7b_19b7d6083e6');
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('Fatal error:', e);
    } finally {
        process.exit(0);
    }
})();
