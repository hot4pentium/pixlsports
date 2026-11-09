---
name: Simplified interactive HYPE Card
description: User-requested full-photo card direction and the boundary with separately authored graphics.
---

Align the PWA with iOS wherever practical, including simplifying the HYPE Card design and flow. Treat the native card as the reference for shared interactions and presentation.

**Why:** The user wants the PWA to mirror iOS as much as possible while establishing a coherent experience for Android.

**How to apply:** Reuse the approved iOS HYPE Card structure and interaction model in the PWA; preserve saved card artwork and independent PWA capabilities unless the user specifically asks to remove them.

No-photo HYPE Card placeholders show the silhouette without the athlete's initial or initials. Keep the athlete's name on the lower-third nameplate.

**Why:** The user explicitly requested removing the player initial from the HYPE Card placeholder.

**How to apply:** Keep this consistent in live card previews and generated artwork, and describe the fallback as a silhouette rather than initials in photo-removal copy.

Interactive athlete HYPE Cards use the full original photo in a 2:3 portrait frame, Pixl Sports branding on the left, athlete name, team, position, number, horizontal/vertical positioning, and three lower-third panel styles anchored at the bottom. The "Text only" choice removes the panel, fills the card with the photo, and keeps identity text over the image. Keep their public side-flip controls.

**Why:** The user wants the entire portrait visible with the lower third at the bottom, matching the supplied reference; the text-only alternative remains available.

**How to apply:** Keep the interactive front, owner preview, and JPG export consistent. Preserve horizontal and vertical photo adjustment. Legacy premium artwork and separately authored moment graphics are independent; do not delete their saved designs or expand this simplification into that separate editor. Owner-preview links must not discard an unsaved appearance draft.

Keep web owner and editor previews bound to the saved-appearance renderer used by the public card, including selected templates, lower thirds, identity, and photo placement. A simplified preview must not make saved design controls appear ineffective or disagree with the shared card.

**Why:** A separate front renderer can ignore saved appearance choices and make the preview, editor controls, and shared card disagree.

**How to apply:** Keep the web owner/editor/public rendering paths consistent and use the 2:3 front frame. Verify that appearance edits visibly update the preview.

The HYPE Card walkthrough should not ask for a custom moment. Leave the headline blank for new cards, use a clear “HYPE Card” fallback in names, preserve saved legacy headline values, and keep separate media clip naming fields.

**Why:** The user said a custom moment input is not needed for the HYPE Card.

**How to apply:** Remove the custom-moment step from HYPE Card setup and review. Do not clear existing saved headline data or remove moment names used for separate media sharing.

Keep the public HYPE Card free of the “Manage this athletic card” banner, including when the viewer owns the card. Keep the taller portrait frame on content sides as well as the front.

**Why:** The user explicitly requested removing the management text and extending the card vertically so more content is visible.

**How to apply:** Preserve side navigation and scrolling for longer content rather than shrinking the card when it flips. Browser checks should allow the 2:3 frame to exceed the old viewport-fit height cap.

For the native iOS public HYPE Card and its shared browser page, let the athlete photo fill the entire front face. Keep Front, Videos, Stats, and Events controls attached beneath the face as one card surface. Selecting a section flips the card horizontally; switching between non-Front sections must never flash the photo. Only Front returns to the photo. Private previews remain front-only.

**Why:** The user requested full-bleed photo coverage and integrated section tabs, rejected flips through Front between other sections, and explicitly approved matching the shared browser card to the iPhone design.

**How to apply:** Keep the native and shared browser card content consistent. A shared link should open the native read-only card when PIXL is installed on iOS, while the same URL continues to show the browser card for recipients without the app. Do not require installation. Keep owner sharing/privacy settings authoritative and retain web follow, Shoutouts, and private-family Live Taps capabilities outside the main tabs.

Do not show or edit Favorite Moment in HYPE Card experiences. Keep previously saved values and API support intact so unrelated settings updates do not erase them.

**Why:** The user asked to remove Favorite Moment completely. Previously saved values should remain untouched rather than being deleted as a side effect.

**How to apply:** Keep the field and caption off native iOS and web HYPE Card screens, and preserve legacy settings values through reads and unrelated saves. This does not affect game-result notes.
