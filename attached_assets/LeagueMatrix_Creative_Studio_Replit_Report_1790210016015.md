# LeagueMatrix Creative Studio

## Product Strategy and Initial Release Plan for Replit

## 1. Executive summary

LeagueMatrix Creative Studio will be a mobile-first web application that helps youth-sports coaches, parents, and organizers create polished sports graphics and printable recognition materials.

The initial release will contain three independent creative tools:

1. Hype-Card Creator
2. Schedule Graphic Maker
3. Awards Creator

LeagueMatrix Creative Studio is intentionally not a league-management platform. It will not manage registrations, payments, teams, rosters, communications, or live league operations. The objective is to build a creative product that can earn income without requiring its owner to operate a high-maintenance software company.

The guiding interaction is:

> Choose → customize → preview → export → leave

Users should be able to create useful finished products without opening an account or providing information that LeagueMatrix must permanently store.

---

## 2. Background and product direction

LeagueMatrix began as a broader concept in which parks and recreation departments could manage leagues while coaches and parents received a shared team hub. That remains an interesting idea, but operating it would require ongoing responsibility for accounts, permissions, private information, hosting, customer support, messaging, security, and daily reliability.

LeagueMatrix Creative Studio takes the most enjoyable part of that concept—creating engaging sports experiences—and removes the operational burden.

This is a creative-product model rather than a traditional software-as-a-service model. The owner can create a tool or template collection, release it, and then choose when to create the next one. Customers receive useful outputs, but LeagueMatrix does not become responsible for running their organizations.

### Product position

**LeagueMatrix — Simple tools for better seasons.**

LeagueMatrix should feel energetic, polished, modern, and sports-focused. It should help an ordinary coach or parent produce graphics that look professionally designed without needing graphic-design experience.

---

## 3. One product containing separate tools

LeagueMatrix Creative Studio should be one web product and one codebase, but its tools should remain independently usable.

A visitor may use only the Hype-Card Creator and never interact with the other tools. Another visitor may come only to make a season schedule. Users should not be forced through a shared league setup, roster import, organization dashboard, or account-registration process.

Suggested structure:

- `/` — Product landing page
- `/studio` — Creative Studio tool directory
- `/studio/hype-card` — Hype-Card Creator
- `/studio/schedule` — Schedule Graphic Maker
- `/studio/awards` — Awards Creator
- `/privacy` — Plain-language privacy explanation
- `/help` — Short instructions and frequently asked questions

The landing page should feature one clear primary action: **Open Creative Studio**.

---

## 4. Web app rather than native app

LeagueMatrix Creative Studio should be built as a responsive web application hosted through Replit, not as separate native iPhone and Android applications.

The web application should:

- Work on phones, tablets, Chromebooks, Macs, and Windows computers.
- Feel app-like on a phone.
- Use large touch-friendly controls.
- Allow users to share a link immediately.
- Allow updates without App Store review or separate mobile releases.
- Be capable of becoming an installable Progressive Web App later.

There should be one maintained version of the product. A native application should be considered only if real usage later demonstrates a compelling need.

---

## 5. How the product works without accounts

The tools should process user content locally in the browser whenever practical.

During a session, the browser holds:

- Uploaded photographs and logos
- Entered names and text
- Team colors
- Template selections
- Element positions and sizes
- Schedule and award information

The user creates a design and exports the finished PNG, JPEG, or PDF. Closing or resetting the tool clears the session unless the user deliberately saves a project.

### Optional account-free saving

Each tool may provide:

- **Save Project** — Download an editable LeagueMatrix project file to the user's device.
- **Open Project** — Reopen a previously downloaded project file.
- **Local Autosave** — Store an unfinished project only in that browser on that device.
- **Reset Project** — Remove the current working data after confirmation.

Use a shared project format such as `.lmx` or a clearly named JSON file. Project files should include a schema version so later releases can remain compatible.

This gives users control over their own work without requiring LeagueMatrix to operate cloud storage, password recovery, account deletion, or cross-device synchronization.

---

## 6. Initial Tool 1: Hype-Card Creator

### Purpose

The Hype-Card Creator lets a coach or parent create a polished individual player graphic for recognition, game-day promotion, social sharing, senior night, player of the week, or end-of-season celebration.

This should be the flagship tool because it is highly visual, immediately understandable, and easy to demonstrate through finished examples.

### Primary user flow

1. Select a sport.
2. Select an output format.
3. Choose a card template.
4. Upload a player photograph.
5. Crop, zoom, reposition, or rotate the photograph.
6. Enter the player's information.
7. Select team colors and optional effects.
8. Preview the completed design in real time.
9. Export the card.
10. Optionally save an editable project file.

### Supported output formats

The first release should support:

- Square social post: 1080 × 1080
- Vertical story: 1080 × 1920
- Landscape announcement: 1920 × 1080
- Printable 5 × 7 card

Templates should be designed for a specific aspect ratio rather than automatically stretching one design into every format.

### Player information fields

- Player name
- Jersey number
- Team name
- Position
- Optional grade or age group
- Optional short statistic
- Optional achievement or title
- Optional short coach message

Users should be able to hide any optional field. Templates must remain attractive when only a name and jersey number are provided.

### Image controls

- Upload player photograph
- Upload optional team logo
- Drag to reposition
- Zoom in and out
- Rotate
- Crop within the template frame
- Flip horizontally
- Basic brightness, contrast, and saturation controls
- Remove an uploaded image

Automatic background removal should not be required for the first release. It may require server processing, an external service, or more browser resources. Initial templates should use frames, masks, gradients, shadows, and overlays that make ordinary photographs look polished.

### Design controls

- Primary team color
- Secondary team color
- Accent color
- Template-approved font choices
- Background texture or pattern
- Optional visual overlays such as stadium lights, turf, geometric shapes, motion lines, or glow
- Show or hide the team logo
- Show or hide LeagueMatrix branding when permitted by the selected template

The templates should preserve professional spacing and hierarchy. Users should customize within safe boundaries rather than freely moving every element and accidentally damaging the design.

### Initial template collection

Launch with at least three original templates:

1. **Spotlight** — Dramatic player image with stadium lighting.
2. **Impact** — Bold jersey number, geometric shapes, and strong team colors.
3. **Clean Game Day** — Minimal, modern design suitable for any sport.

Do not use copyrighted professional team artwork, league marks, or unlicensed school logos. Users may upload artwork they are authorized to use.

### Exports

- High-resolution PNG
- Sharing-optimized JPEG
- Printable PDF where appropriate
- Editable LeagueMatrix project file

The exported design must closely match the on-screen preview. Text, images, clipping masks, shadows, and color effects must render consistently.

### Privacy behavior

Player photos, logos, names, and statistics should remain in the browser and should not be transmitted or permanently stored. Place a short message beside the uploader:

> Your photos and player information stay on this device and are not saved by LeagueMatrix.

### Future monetization possibilities

- Free core templates
- Basketball template pack
- Soccer template pack
- Football template pack
- Baseball and softball template pack
- Senior-night collection
- Player-of-the-week collection
- Championship collection

Do not implement payment processing during the initial build. Organize templates so future free and premium collections can be added without rebuilding the editor.

---

## 7. Initial Tool 2: Schedule Graphic Maker

### Purpose

The Schedule Graphic Maker turns a basic list or spreadsheet of games and practices into a polished graphic that a team can post, print, email, or distribute.

It should support both full-season schedules and shorter weekly or tournament schedules.

### Primary user flow

1. Choose the schedule type.
2. Choose a design template and output format.
3. Enter team and season information.
4. Enter games manually, paste spreadsheet rows, or upload a CSV.
5. Review and correct imported entries.
6. Add team colors, logo, and optional background image.
7. Preview the schedule in real time.
8. Export the finished schedule.
9. Optionally export a calendar file or save the editable project.

### Schedule types

- Full-season schedule
- Monthly schedule
- Weekly schedule
- Practice schedule
- Tournament weekend schedule
- Home-games-only schedule
- Individual game-day announcement

### Schedule fields

- Date
- Start time
- Opponent
- Home, away, or neutral location
- Field, court, or facility
- Game type or division
- Optional uniform color
- Optional short note
- Cancelled or postponed status

Only the fields relevant to the chosen design should appear. A clean schedule should not become visually crowded because optional information was entered.

### Data-entry methods

#### Manual entry

- Add one event at a time.
- Duplicate an existing event.
- Reorder events by dragging.
- Automatically sort chronologically.
- Delete or temporarily hide an event.

#### Spreadsheet paste

Allow users to paste rows copied from Excel or Google Sheets into a preview table. Provide a mapping step so the user can identify which column contains the date, opponent, location, and other information.

#### CSV import

- Upload a CSV locally.
- Preview its rows before importing.
- Map column headings.
- Identify incomplete or invalid rows.
- Allow the user to correct data before generating the design.

The imported data should not be uploaded to a server.

### Branding controls

- Team name
- Season name or year
- Primary, secondary, and accent colors
- Team logo uploaded by the user
- Optional background photograph
- Home and away indicators
- Optional opponent logos uploaded by the user

### Initial template collection

1. **Season Poster** — Full-season layout with prominent team branding.
2. **Weekly Matchup** — Compact weekly social-media graphic.
3. **Clean Calendar** — Highly readable schedule suitable for printing.

Templates must gracefully handle different numbers of games. Establish reasonable limits for each design and warn users when a selected template cannot display every entry clearly.

### Outputs

- Square PNG
- Vertical story PNG
- Landscape PNG
- Letter-size printable PDF
- Downloadable `.ics` calendar file
- Editable LeagueMatrix project file

The calendar export should contain only information the user entered and should not require calendar-account access.

### Update workflow

Users should be able to reopen a saved project file, change a game, mark it postponed, and export a revised graphic. LeagueMatrix will not host or automatically update a public schedule.

### Future monetization possibilities

- Premium seasonal poster designs
- Tournament-weekend collections
- Minimal professional template pack
- Stadium and field-background collections
- Multi-team organization templates

---

## 8. Initial Tool 3: Awards Creator

### Purpose

The Awards Creator helps coaches recognize an entire team by creating personalized certificates and shareable award graphics in batches.

It should be positive, inclusive, and fast enough that a coach can prepare an entire team's awards in one sitting.

### Primary user flow

1. Select the sport and award collection.
2. Choose certificate, social graphic, or complete package.
3. Enter or paste the roster.
4. Assign an award to each player.
5. Customize team and presentation information.
6. Add optional personal messages.
7. Preview each player's award.
8. Export individual files or one combined package.
9. Optionally save the editable project.

### Roster input

- Enter players individually.
- Paste a column of names from a spreadsheet.
- Upload a simple CSV.
- Edit, reorder, or remove names after import.

The roster should remain in the browser and should not be saved by LeagueMatrix.

### Award information

- Player name
- Award title
- Team name
- Sport
- Season or year
- Coach name
- Presentation date
- Optional personalized message
- Optional jersey number
- Optional team logo

### Suggested built-in awards

- Most Improved
- Best Teammate
- Sportsmanship Award
- Leadership Award
- Hustle Award
- Defensive Player
- Offensive Player
- Coach's Award
- Practice Champion
- Positive Attitude Award
- Custom Award

Users must be able to create their own award titles. Avoid ranking children publicly or generating negative comparative labels.

### Assignment interface

Display the roster in a simple table with an award dropdown beside each player. Include:

- Duplicate-award indicator
- Missing-award indicator
- Custom award entry
- Optional personal message field
- Preview button for each player
- Apply one visual template to the entire team

A duplicate award should produce a notice, not an error, because coaches may intentionally give the same award to multiple players.

### Package types

#### Certificate package

- Printable landscape or portrait certificates
- Consistent team branding
- Signature line
- Optional date and coach name

#### Social recognition package

- Square award graphic for each player
- Optional vertical story version
- Team thank-you graphic

#### End-of-season package

- Player certificates
- Social award graphics
- Team roster poster
- Coach thank-you certificate
- Banquet place cards

The initial release may begin with certificates and square graphics. The full banquet package can follow after the core generation and export system is reliable.

### Initial template collection

1. **Classic Certificate** — Clean and printable with restrained sports accents.
2. **Stadium Celebration** — Energetic social graphic with lights and team colors.
3. **Modern Team** — Minimal design suitable for any sport or age group.

### Batch export

- Preview every award before export.
- Generate a combined multi-page PDF.
- Download an individual PNG for each player.
- Download all graphics together as a ZIP.
- Use safe, readable filenames.
- Display progress during larger exports.
- Prevent accidental duplicate filenames.

### Privacy behavior

Names, award selections, messages, logos, and roster data must remain on the user's device. Include a visible explanation that LeagueMatrix does not save the roster.

### Future monetization possibilities

- Sport-specific certificate packs
- End-of-season banquet collections
- Senior recognition collection
- Championship collection
- Coach and volunteer appreciation pack
- Premium printable bundles

---

## 9. Shared Creative Studio system

The three tools should share reusable components rather than becoming separate applications.

### Shared components

- LeagueMatrix header and navigation
- Tool directory cards
- Responsive editor shell
- Template gallery
- Color picker
- Font selector with curated choices
- Text-input controls
- Photo and logo uploader
- Crop and positioning controls
- Live preview canvas
- Undo and redo
- Export dialog
- Local autosave
- Project save and open controls
- Reset confirmation
- Privacy notice
- Error and validation messages

### Consistent editor layout

Desktop:

- Controls on the left
- Large preview in the center or right
- Export action clearly visible

Mobile:

- Preview near the top
- Controls organized in collapsible sections or bottom sheets
- Sticky Preview and Export actions
- No tiny drag handles or hover-only controls

### Shared project format

Create one versioned LeagueMatrix project structure with a tool identifier. It should store:

- Tool type
- Schema version
- Selected template
- Output dimensions
- Text fields
- Color choices
- Uploaded-asset references or embedded assets
- Image transformations
- Tool-specific rows such as games or awards

Opening a project file should validate its format and show a friendly error if it is damaged or from an unsupported future version.

---

## 10. Design direction

LeagueMatrix Creative Studio should look like a creative sports product, not a league administrator dashboard.

### Desired qualities

- Energetic
- Confident
- Modern
- Visually rich without becoming cluttered
- Easy for non-designers
- Appropriate for youth and adult recreational sports
- Consistent across all three tools

### Visual elements

- Bold sports typography
- Dark neutral foundations with vibrant team-color accents
- Stadium light, field texture, motion, and geometric motifs
- Strong visual hierarchy
- Large example graphics
- Restrained transitions and animations

### Avoid

- Dense administrative tables outside necessary import screens
- Excessive glass effects
- Gambling or sports-betting aesthetics
- Copyrighted professional-team branding
- Cartoonish interfaces
- Unrestricted design controls that make templates easy to break
- Mandatory tutorials before a user can begin

---

## 11. Monetization strategy

Do not build subscriptions, user accounts, or custom payment infrastructure into the initial release.

### Initial launch

- Make the three core tools free to test demand.
- Include a small collection of strong free templates.
- Measure tool opens, completed exports, template selections, and device types without collecting player information.
- Provide an optional feedback form that does not require an account.

### Potential later revenue

- One-time template-pack purchases
- Sport-specific design collections
- Seasonal collections
- End-of-season bundles
- Complete LeagueMatrix Creative Studio bundle
- Optional sponsor-supported free templates

Use an external digital-product checkout if monetization is added. Avoid recurring subscriptions unless future customers clearly request an ongoing service.

The product should remain useful even if monetization is limited to occasional template releases.

---

## 12. Explicit exclusions

Do not add the following without separate approval:

- User registration or login
- Cloud project saving
- Player or child profiles
- Stored rosters
- Team-management dashboards
- Parks and recreation administration
- Registration and payment collection
- Messaging between coaches, parents, or athletes
- Push notifications
- Live schedules or standings
- Public player directories
- Native iPhone or Android apps
- AI-generated player images
- Automatic background-removal services
- Social networking features
- Custom features for individual organizations

These exclusions are central to keeping the product manageable.

---

## 13. Recommended implementation sequence

### Phase 0: Recovered-project audit

Before changing code, Replit should report:

1. Current framework and dependency versions.
2. Existing routes, components, and features.
3. Existing LeagueMatrix and MotiCoach branding.
4. Existing image assets, fonts, and design components.
5. Whether the application currently runs.
6. Existing database, authentication, messaging, or Firebase dependencies.
7. Code that can be safely reused.
8. Code that belongs to the old management-platform concept.
9. Missing secrets or environment variables.
10. A proposed file-by-file implementation plan.

Do not delete the old code during this phase. Preserve it in Git history and create a recovery checkpoint.

### Phase 1: Shared foundation

- Establish LeagueMatrix Creative Studio branding.
- Create the landing page and Studio directory.
- Build the responsive editor shell.
- Build shared template, color, upload, preview, and export components.
- Establish the versioned local project-file format.
- Add privacy and help pages.

### Phase 2: Hype-Card Creator

- Build the flagship editor.
- Create three templates.
- Implement photo controls.
- Implement PNG and JPEG export.
- Add project save/open.
- Test thoroughly on mobile and desktop.

### Phase 3: Schedule Graphic Maker

- Add manual schedule entry.
- Add spreadsheet paste and CSV import.
- Build three schedule templates.
- Add PNG, PDF, and `.ics` export.
- Reuse the shared editor and project system.

### Phase 4: Awards Creator

- Add roster entry, paste, and CSV import.
- Build the award-assignment interface.
- Create three award templates.
- Add combined PDF and batch image export.
- Add ZIP packaging after individual export is reliable.

### Phase 5: Launch preparation

- Run mobile, desktop, accessibility, and export-quality testing.
- Confirm that user content is not transmitted or retained.
- Add basic privacy-respecting product analytics.
- Add clear examples and simple instructions.
- Deploy the initial release through Replit.

---

## 14. Initial-release acceptance criteria

The initial release is complete when:

- The application runs reliably in Replit.
- All three tools are accessible from one Creative Studio directory.
- Each tool works without an account.
- The interface is usable on phones, tablets, and computers.
- Uploaded photos, logos, schedules, and rosters remain local.
- Users can save and reopen editable project files.
- Hype cards export accurately as high-resolution images.
- Schedules export accurately as images and PDFs.
- Awards export individually and as a combined PDF.
- At least three original templates are available for each tool.
- Empty, excessive, and invalid inputs produce friendly guidance.
- Exported files match their on-screen previews.
- The site contains clear privacy and help information.
- No legacy league-management feature is accidentally exposed.
- The project has a current GitHub backup and clear deployment instructions.

---

## 15. Instructions to Replit Agent

Begin with Phase 0 only.

Do not immediately redesign, migrate, or rewrite the recovered application. Do not add authentication, a database, subscriptions, or additional league-management features.

First inspect the complete repository and provide:

- A plain-language audit of what currently exists
- Screenshots or descriptions of the current screens
- An inventory of reusable LeagueMatrix assets
- A list of old features that should be isolated rather than deleted
- The proposed component and route architecture
- A phased file-change plan
- Identified risks or missing information

Wait for approval before implementing Phase 1.
