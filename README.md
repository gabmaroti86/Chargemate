# ChargeMate Car Mode Preview

This build adds a landscape, low-distraction car interface that can be opened using the **Car mode** button or by loading the page with:

`?car=1`

This is a visual prototype only. A browser cannot register as an Apple CarPlay or Android Auto app and cannot automatically launch when a phone is plugged into a vehicle.

For production:

- Android requires a native Android app using the Android for Cars App Library.
- Apple requires a native iOS app using the CarPlay framework and an approved CarPlay entitlement.
- The native app can route users directly into the car interface when the platform launches the app from the vehicle display.

# ChargeMate Test Build

## How to test before publishing

1. Open `index.html`.
2. Press **Test demo**.
3. Sample chargers will appear immediately.
4. Try:
   - Filters
   - Station ID search using `CFX-1001`
   - Price button
   - QR manual entry using `EVCHARGER:BP-2204`
   - Trip planner
   - Card wallet
   - Map and charger cards

## Important browser limitations before publishing

Some features require HTTPS and may not fully work from a local file:

- Live GPS location
- Camera QR scanning
- Phone login
- Google login
- NFC scanning
- Firebase chat
- Live charger APIs

GitHub Pages provides HTTPS, so those features can be tested properly after a private test deployment.

# ChargeMate — Charging Card Wallet Edition

## What the wallet does

- Stores charging-network name
- Stores a nickname
- Stores a masked printed card or tag serial number
- Stores a network/account link
- Supports Chargefox, bp pulse, Evie, NRMA, Exploren, Wevolt, Everty, EVX, Tesla and custom networks
- Reads compatible NFC NDEF tags on supported Android browsers
- Requires sign-in before opening the wallet
- Includes a secure backend hook for a one-time A$1 wallet setup fee

## What the wallet does not do

It does not clone, copy, emulate or replace protected RFID charging credentials. Most EV charging RFID cards are secure access credentials and are not readable or emulatable through browser Web NFC.

The physical card or the official charging-network app remains necessary to start a charging session unless the network separately supports app-based roaming or contactless payment.

## A$1 checkout endpoint

Do not collect payment-card details directly in this static web app. Configure a secure backend endpoint that creates a Stripe Checkout session.

Expected request:

```json
{
  "amountAudCents": 100,
  "product": "chargemate_card_wallet",
  "successUrl": "https://your-app.example/?wallet=success",
  "cancelUrl": "https://your-app.example/"
}
```

Expected response:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

The backend must verify the Firebase ID token, create the Checkout session, verify payment with a webhook, and store activation server-side. The browser local-storage activation flag in this prototype is only a UI convenience and must not be treated as proof of payment.

## NFC support

Web NFC works only with compatible NDEF tags and supported devices/browsers. It does not provide low-level RFID credential access. Always provide manual entry as the fallback.
