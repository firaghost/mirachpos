# Customer Display Manager Control

## Goal
Make the customer display dynamic across orders, fix receipt→menu glitches, and add manager/waiter-manager control over what the display shows.

## Tasks
- [ ] Audit current display mode flow (WaiterPayment/WaiterReceipt + public display polling) and identify why receipt view sticks. → Verify: reproduce issue and note which API responses prevent menu view.
- [ ] Update display mode persistence so receipt auto-switch doesn’t get overridden by polling and new orders update the same display window. → Verify: receipt shows, then menu in 3s, then next payment switches back to payment.
- [ ] Add a dedicated “Customer Display” control panel accessible to Branch Manager + Waiter Manager to set mode (Auto/Menu/Payment/Receipt). → Verify: only those roles see the panel and can change mode.
- [ ] Add backend support for explicit manager override mode and store it with display link meta. → Verify: API returns effective mode and honors override even during polling.
- [ ] Ensure display window opens if closed and reuses existing if already open. → Verify: new payment opens window if closed; otherwise updates same window.

## Done When
- [ ] Display always updates to the latest order without opening new tabs.
- [ ] Receipt auto-switches to menu after 3s unless manager override is active.
- [ ] Manager/Waiter Manager can control display mode from a dedicated panel.
