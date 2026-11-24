/* =====================================================================
   TOUCHPOINTS REQUEST FORM — SETTINGS
   This is the only file you normally need to edit.
   After editing on GitHub, click "Commit changes"; phones pick it up the
   next time they open the app with signal.
   ===================================================================== */

window.APP_CONFIG = {
  // Paste your Apps Script Web App URL here (ends with /exec) — see Step 4.
  API_URL: 'https://script.google.com/macros/s/AKfycbwp9svdOwqHmROidv0Ep_J_CARU0BRlMQkacuNuUsnE8c0uCGp3yWKiBwQ3WqReWadX/exec',

  APP_NAME: 'Touchpoints Request',

  // Terms and Conditions page (opens in a new tab)
  TERMS_URL: 'https://sites.google.com/view/cti-termsandcondition-v2025/home',

  // Consent text shown on the agreement step. HTML is allowed (<p>, <ul>, <li>, <b>).
  CONSENT_HTML: `
    <p><b>[TOP PART OF THE CONSENT TEXT — TO BE ADDED]</b></p>
    <ul>
      <li>Identity validation;</li>
      <li>Improvement of our business and operations and products and services;</li>
      <li>Compliance with legal and regulatory requirements.</li>
    </ul>
    <p>You also consent that the personal information collected in this form may be shared by Cignal TV to the following for the same purposes as mentioned above:</p>
    <ul>
      <li>Other service providers, contractors, professional advisers, and their sub-contractors.</li>
      <li>Our Subsidiaries and Affiliates;</li>
      <li>Other companies to whom you have also given consent for us to share your information with; and</li>
      <li>Law enforcement and government agencies, but only when required by laws and regulations and other lawful orders and processes.</li>
    </ul>
    <p>Your personal data will be kept in our records for as long as you remain an authorized trade partner of Cignal TV. Upon the termination or expiration of your authorization, we shall continue to retain your personal information for a further period of Ten (10) years in anticipation of future reactivation of your authorization to act as trade partner. You may request us to correct any inaccurate data we may have collected from you, erase, remove or access data you have provided or even object to the continued processing of your personal information. For this, you may email us at <a href="mailto:dpoffice@cignaltv.com.ph">dpoffice@cignaltv.com.ph</a></p>
  `
};
