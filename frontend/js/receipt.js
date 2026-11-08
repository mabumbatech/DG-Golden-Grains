(async function init() {
    await requireAuth();

    const params = new URLSearchParams(window.location.search);
    const saleId = params.get('id');

    if (!saleId) {
        document.getElementById('receiptContent').innerHTML =
            '<div class="not-found">No sale specified.</div>';
        return;
    }

    const res = await API.get('sales.php', { id: saleId });

    if (!res.success) {
        document.getElementById('receiptContent').innerHTML =
            `<div class="not-found">${res.message}</div>`;
        return;
    }

    renderReceipt(res.data);
})();


function renderReceipt(s) {

    const receiptNo = 'EDK-' + String(s.id).padStart(6, '0');

    const saleDate = new Date(
        (s.sale_date || '') + 'T00:00:00'
    );

    const createdAt = s.created_at ?
        new Date(s.created_at.replace(' ', 'T')) :
        saleDate;


    /* Payment method */
    let paymentLine = 'Cash';

    if (s.payment_method === 'credit') {
        paymentLine = 'Credit';
    } else if (s.cash_type === 'online') {
        paymentLine = 'Cash (' + (s.online_method || 'Online') + ')';
    }


    /* Items */
    const itemsHtml = s.items.map((item, i) => `
        <div class="item-row">

            <div class="item-name">
                ${i + 1}. ${item.product_name}
            </div>

            <div class="row">
                <span class="k">
                    ${fmtQty(item.quantity)} ${item.unit || ''} x ${money(item.unit_price)}
                </span>

                <span>
                    ${money(item.subtotal)}
                </span>
            </div>

        </div>
    `).join('');


    /* Customer information */
    const customerBlock =
        (s.customer_name || s.customer_phone) ? `

        <hr>

        <div class="row">
            <span class="k">Customer</span>
            <span>${s.customer_name || '—'}</span>
        </div>

        ${s.customer_phone ? `
            <div class="row">
                <span class="k">Phone</span>
                <span>${s.customer_phone}</span>
            </div>
        ` : ''}

        ${s.payment_method === 'credit' && s.credit_deadline ? `
            <div class="row">
                <span class="k">Pay by</span>
                <span>${fmtDate(s.credit_deadline)}</span>
            </div>
        ` : ''}

    ` : '';


    /* Customer change left with the shop (money the shop owes the customer) */
    const changeAmount = Number(s.change_amount) || 0;
    const changeCollected = Number(s.change_collected) || 0;
    const changeRemaining = Number(s.change_remaining) || 0;
    const changeBlock = changeAmount > 0 ? `

                <div class="row">
                    <span class="k">Customer Change</span>
                    <span>${money(changeAmount)}</span>
                </div>

                ${changeCollected > 0 ? `
                    <div class="row">
                        <span class="k">Change Collected</span>
                        <span>${money(changeCollected)}</span>
                    </div>
                ` : ''}

                <div class="row">
                    <span class="k">Change Balance</span>
                    <span>${changeRemaining > 0 ? money(changeRemaining) + ' (Pending)' : 'Collected'}</span>
                </div>

    ` : '';


    /* Paid / balance lines.
       Cash sale: simply PAID.  Credit sale: what was paid (each payment, incl. any paid at the time
       of sale) and the balance still owed. */
    let paymentBlock;
    if (s.payment_method === 'credit') {
        const paid = Number(s.paid_amount) || 0;
        const balance = Math.max(Number(s.balance_due != null ? s.balance_due : (Number(s.total_amount) - paid)), 0);
        const payRows = (s.debt_payments || []).map(p => {
            const how = p.method === 'online' ? (p.online_method || 'Online') : 'Cash';
            // Paid on the day of the sale -> just "Paid (method)"; a later payment also shows its short date.
            const later = p.payment_date !== s.sale_date;
            const when = later ? new Date(p.payment_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' : '';
            return `
                <div class="row">
                    <span class="k">Paid ${when}(${how})</span>
                    <span class="v-green">${money(p.amount)}</span>
                </div>`;
        }).join('');
        const status = balance <= 0 ? 'PAID IN FULL' : (paid > 0 ? 'PART PAID' : 'UNPAID');
        paymentBlock = `
                ${payRows}

                <div class="row balance-row">
                    <span>BALANCE DUE</span>
                    <span class="${balance > 0 ? 'v-due' : 'v-green'}">${money(balance)}</span>
                </div>

                <div class="row">
                    <span class="k">Status</span>
                    <span>${status}</span>
                </div>
        `;
    } else {
        paymentBlock = `
                <div class="row">
                    <span class="k">Status</span>
                    <span>PAID</span>
                </div>
        `;
    }


    /* Receipt */
    document.getElementById('receiptContent').innerHTML = `

        <div class="receipt-paper">

            <!-- SHOP HEADER -->
            <div class="center receipt-header">

                <img
                    src="assets/logo1.png"
                    alt="GOLDEN GRAINS Logo"
                    class="logo"
                >

                <div class="shop-tagline">
                    Quality in Every Grain
                </div>

                <div class="shop-meta">
                    Tel / WhatsApp: +255 715 661 112
                </div>

            </div>


            <!-- RECEIPT INFORMATION -->
            <hr>

            <div class="row">
                <span class="k">Receipt No.</span>
                <span class="receipt-id">
                    ${receiptNo}
                </span>
            </div>

            <div class="row">
                <span class="k">Date</span>
                <span>
                    ${saleDate.toLocaleDateString('en-GB')}
                </span>
            </div>

            <div class="row">
                <span class="k">Time</span>
                <span>
                    ${createdAt.toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit'
                    })}
                </span>
            </div>

            <div class="row">
                <span class="k">Served by</span>
                <span>
                    ${s.sold_by_name}
                </span>
            </div>


            <!-- ITEMS -->
            <hr>

            ${itemsHtml}


            <!-- TOTALS -->
            <div class="totals">

                <div class="row grand-total">
                    <span>TOTAL</span>
                    <span>
                        ${money(s.total_amount)}
                    </span>
                </div>

                <div class="row">
                    <span class="k">Payment</span>
                    <span>
                        ${paymentLine}
                    </span>
                </div>

                ${paymentBlock}

                ${changeBlock}

            </div>


            <!-- CUSTOMER -->
            ${customerBlock}


            <!-- FOOTER -->
            <hr>

            <div class="footer-note">
                Thank you for choosing GOLDEN GRAINS!<br>
                No returns without this receipt.
            </div>

        </div>
    `;
}