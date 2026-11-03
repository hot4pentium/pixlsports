import XCTest
import UIKit

@MainActor
final class SupporterEventDetailUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    // Opt-in integration tests. Use a disposable development account already
    // signed in and linked on this simulator; never pass credentials to XCTest.
    // Unlike --ui-testing-prep-draft these use the real authenticated API.
    func testSignedInQuickPrepCheckoffAutosavesAndPersistsAfterReopening() throws {
        try checkSignedInPrepPersistence(dropFirstResponse: false)
    }

    func testSignedInQuickPrepLostResponseRetriesSameMutationAfterRelaunch() throws {
        try checkSignedInPrepPersistence(dropFirstResponse: true)
    }

    func testSignedInCustomPrepTaskAutosavesAndPersistsAfterRelaunch() throws {
        guard let eventID = ProcessInfo.processInfo.environment["PIXL_PREP_TEST_EVENT_ID"],
              !eventID.isEmpty else {
            throw XCTSkip("Set PIXL_PREP_TEST_EVENT_ID to a dedicated development Event Card. Sign in and link its owner on this simulator first.")
        }

        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-signed-in-prep"]
        app.launch()
        defer { app.terminate() }
        openSignedInPrep(eventID: eventID, in: app)

        let label = "Pack custom reminder \(UUID().uuidString.prefix(8))"
        assertReachable("native-prep-manage-full", in: app).tap()
        let taskField = assertReachable("native-prep-add-task", in: app)
        taskField.tap()
        taskField.typeText(label)
        assertReachable("native-prep-add", in: app).tap()

        let task = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        waitForPrepSavedAfterChange(in: app)
        task.tap()
        XCTAssertEqual(task.value as? String, "Ready")
        waitForPrepSavedAfterChange(in: app)

        app.terminate()
        app.launch()
        openSignedInPrep(eventID: eventID, in: app)
        assertReachable("native-prep-manage-full", in: app).tap()
        let restoredTask = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(restoredTask.waitForExistence(timeout: 10))
        XCTAssertEqual(restoredTask.value as? String, "Ready",
                       "A custom task's completed state must survive a fresh app launch.")

        restoredTask.press(forDuration: 1)
        let removeTask = app.buttons["Remove task"].firstMatch
        XCTAssertTrue(removeTask.waitForExistence(timeout: 5))
        removeTask.tap()
        waitForPrepSavedAfterChange(in: app)
    }

    func testEventCardCreationFormSupportsBlankTeamProfile() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-create-event-card"]
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.staticTexts["Create an Event Card"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["SEASON · FALL 2026"].exists)
        XCTAssertTrue(app.textFields["native-event-opponent"].exists)
        XCTAssertTrue(app.textFields["native-event-location"].exists)
        let submit = app.buttons["native-event-create-submit"]
        XCTAssertTrue(submit.exists)
        XCTAssertFalse(submit.isEnabled, "The fixture is signed out; team details must not be the reason creation is blocked.")
        XCTAssertTrue(app.staticTexts["Sign in on this iPhone to create an Event Card."].exists)
    }

    func testSignedInTrackStatsOffersExplainedToolChoicesInLandscapeAtXXXL() throws {
        guard let eventID = ProcessInfo.processInfo.environment["PIXL_TRACKING_TEST_EVENT_ID"],
              !eventID.isEmpty else {
            throw XCTSkip("Set PIXL_TRACKING_TEST_EVENT_ID to a dedicated upcoming game Event Card. Sign in and link its owner on this simulator first.")
        }

        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-signed-in-prep",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ]
        app.launch()
        defer { app.terminate() }
        rotate(.landscapeLeft, in: app)
        openSignedInPrep(eventID: eventID, in: app)

        let trackStats = app.buttons["event-card-track-stats"]
        XCTAssertTrue(trackStats.isEnabled, "The dedicated Event Card must be a game.")
        trackStats.tap()

        let statTrackerChoice = app.buttons["native-event-choice-statTracker"]
        let liveTapsChoice = app.buttons["native-event-choice-liveTaps"]
        XCTAssertTrue(statTrackerChoice.waitForExistence(timeout: 10))
        XCTAssertTrue(liveTapsChoice.exists)
        assertModeChoiceAndHelpReachable("statTracker", in: app)
        assertModeChoiceAndHelpReachable("liveTaps", in: app)
        let chooser = app.descendants(matching: .any)["native-event-mode-choice-sheet"]
        XCTAssertTrue(chooser.exists)

        let statTrackerHelp = assertModeChooserReachable("native-event-mode-help-statTracker", in: app)
        XCTAssertEqual(statTrackerHelp.label, "Explain Stat Tracker")
        XCTAssertEqual(statTrackerHelp.value as? String, "Explanation hidden")
        statTrackerHelp.tap()
        let statTrackerExplanation = assertModeChooserReachable(
            "native-event-mode-explanation-statTracker", in: app
        )
        XCTAssertTrue(statTrackerExplanation.isHittable)
        XCTAssertTrue(statTrackerExplanation.label.contains("team score"))
        XCTAssertGreaterThan(statTrackerExplanation.frame.height, 0)
        assertModeExplanationDoesNotOverlapControls(
            statTrackerExplanation,
            in: app,
            chooser: chooser
        )
        retainTrackingChooserScreenshot(in: app, name: "Stat Tracker explanation — landscape — AX XXXL")
        XCTAssertEqual(statTrackerHelp.label, "Hide Stat Tracker")
        XCTAssertEqual(statTrackerHelp.value as? String, "Explanation shown")

        let liveTapsHelp = assertModeChooserReachable("native-event-mode-help-liveTaps", in: app)
        XCTAssertEqual(liveTapsHelp.label, "Explain Live Taps")
        XCTAssertEqual(liveTapsHelp.value as? String, "Explanation hidden")
        liveTapsHelp.tap()
        let liveTapsExplanation = assertModeChooserReachable(
            "native-event-mode-explanation-liveTaps", in: app
        )
        XCTAssertTrue(liveTapsExplanation.isHittable)
        XCTAssertTrue(liveTapsExplanation.label.contains("cheer-only"))
        XCTAssertEqual(liveTapsHelp.label, "Hide Live Taps")
        XCTAssertEqual(liveTapsHelp.value as? String, "Explanation shown")
        assertModeExplanationDoesNotOverlapControls(
            liveTapsExplanation,
            in: app,
            chooser: chooser
        )
        retainTrackingChooserScreenshot(in: app, name: "Live Taps explanation — landscape — AX XXXL")
        try app.performAccessibilityAudit(for: [.textClipped, .hitRegion]) { issue in
            guard let element = issue.element else { return false }
            return !element.frame.intersects(chooser.frame)
        }

        assertModeChooserReachable("native-event-choice-statTracker", in: app).tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["native-event-scorekeeping-card"].waitForExistence(timeout: 10)
        )
        app.buttons["native-event-switch-tracking-mode"].tap()
        XCTAssertTrue(liveTapsChoice.waitForExistence(timeout: 5))
        liveTapsChoice.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["native-event-live-taps-section"].waitForExistence(timeout: 10)
        )
        let liveTapsIntro = app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "Start a cheer-only session for fans at the game"
        )).firstMatch
        XCTAssertTrue(liveTapsIntro.waitForExistence(timeout: 10))
    }

    private func retainTrackingChooserScreenshot(in app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Tracking chooser — \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func assertModeExplanationDoesNotOverlapControls(
        _ explanation: XCUIElement,
        in app: XCUIApplication,
        chooser: XCUIElement
    ) {
        assertContained(explanation.frame, in: chooser.frame)
        let controlIdentifiers = [
            "native-event-choice-statTracker",
            "native-event-mode-help-statTracker",
            "native-event-choice-liveTaps",
            "native-event-mode-help-liveTaps"
        ]
        for identifier in controlIdentifiers {
            let control = app.descendants(matching: .any)[identifier].firstMatch
            XCTAssertTrue(control.exists, "Missing \(identifier)")
            XCTAssertFalse(
                explanation.frame.intersects(control.frame),
                "\(explanation.identifier) must not overlap \(identifier)."
            )
        }
    }

    private func assertModeChoiceAndHelpReachable(_ mode: String, in app: XCUIApplication) {
        let choice = assertModeChooserReachable("native-event-choice-\(mode)", in: app)
        let help = assertModeChooserReachable("native-event-mode-help-\(mode)", in: app)
        XCTAssertGreaterThanOrEqual(choice.frame.width, 44)
        XCTAssertGreaterThanOrEqual(choice.frame.height, 44)
        XCTAssertGreaterThanOrEqual(help.frame.width, 44)
        XCTAssertGreaterThanOrEqual(help.frame.height, 44)
        XCTAssertFalse(choice.frame.intersects(help.frame), "\(mode) choice and help hit targets must not overlap.")
    }

    @discardableResult
    private func assertModeChooserReachable(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(identifier)")
        let chooser = app.descendants(matching: .any)["native-event-mode-choice-sheet"]
        XCTAssertTrue(chooser.exists, "The tracking-mode chooser must remain open while scrolling.")
        for _ in 0..<12 where !element.isHittable {
            if element.frame.minY < chooser.frame.minY {
                chooser.swipeDown()
            } else {
                chooser.swipeUp()
            }
        }
        XCTAssertTrue(element.isHittable, "\(identifier) must remain reachable in the chooser")
        return element
    }

    func testSignedInLiveTapsFanQRSurvivesTrackingToolSwitchAndCanBeRevoked() throws {
        guard let eventID = ProcessInfo.processInfo.environment["PIXL_TRACKING_TEST_EVENT_ID"],
              !eventID.isEmpty else {
            throw XCTSkip("Set PIXL_TRACKING_TEST_EVENT_ID to a dedicated Event Card with an active Live Taps-only session. Sign in and link its owner on this iPhone first.")
        }

        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-signed-in-prep"]
        app.launch()
        defer { app.terminate() }
        openSignedInPrep(eventID: eventID, in: app)

        assertReachable("event-card-track-stats", in: app).tap()
        let liveTapsChoice = app.buttons["native-event-choice-liveTaps"]
        XCTAssertTrue(liveTapsChoice.waitForExistence(timeout: 10))
        liveTapsChoice.tap()

        let activeSession = app.descendants(matching: .any)["live-taps-session-status"].firstMatch
        XCTAssertTrue(activeSession.waitForExistence(timeout: 20),
                      "Load the dedicated Event Card’s existing Live Taps session; this test must not start another session.")
        let createQR = app.buttons["native-live-taps-create-qr"]
        XCTAssertTrue(createQR.waitForExistence(timeout: 10))
        let createQRReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isEnabled == true"),
            object: createQR
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [createQRReady], timeout: 15),
            .completed,
            "The dedicated Event Card must have an active Live Taps-only session before this test creates a QR."
        )
        createQR.tap()

        let qr = app.images.matching(NSPredicate(
            format: "identifier BEGINSWITH %@", "native-live-taps-qr-"
        )).firstMatch
        XCTAssertTrue(qr.waitForExistence(timeout: 15), "The newly created fan QR must be visible.")
        let originalQRIdentifier = qr.identifier
        XCTAssertTrue(originalQRIdentifier.hasPrefix("native-live-taps-qr-"))
        XCTAssertEqual(
            assertReachable("native-live-taps-qr-status", in: app).label,
            "QR ready to show or share"
        )

        assertReachable("native-event-switch-tracking-mode", in: app).tap()
        XCTAssertTrue(app.buttons["native-event-choice-statTracker"].waitForExistence(timeout: 5))
        app.buttons["native-event-choice-statTracker"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["native-event-scorekeeping-card"].waitForExistence(timeout: 10)
        )

        assertReachable("native-event-switch-tracking-mode", in: app).tap()
        XCTAssertTrue(liveTapsChoice.waitForExistence(timeout: 5))
        liveTapsChoice.tap()
        XCTAssertTrue(
            app.images[originalQRIdentifier].waitForExistence(timeout: 10),
            "Returning to Live Taps must show the same QR grant, not create a replacement."
        )
        XCTAssertTrue(activeSession.exists, "Switching tools must keep the same Live Taps session loaded.")
        XCTAssertFalse(app.buttons["native-live-taps-start"].exists,
                       "Returning to the active session must not offer to start a second one.")
        XCTAssertFalse(app.buttons["native-live-taps-create-qr"].exists,
                       "A ready QR must not offer another create action after returning.")

        assertReachable("native-live-taps-revoke-qr", in: app).tap()
        let confirmRevoke = app.buttons["Revoke QR access"]
        XCTAssertTrue(confirmRevoke.waitForExistence(timeout: 5))
        confirmRevoke.tap()
        let revokedQR = app.images[originalQRIdentifier]
        let qrRemoved = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: revokedQR
        )
        XCTAssertEqual(XCTWaiter.wait(for: [qrRemoved], timeout: 15), .completed,
                       "Revoking the ready QR must remove that same grant from the view.")
        XCTAssertTrue(activeSession.exists, "Revoking fan access must not end the Live Taps session.")
        XCTAssertEqual(
            assertReachable("native-live-taps-qr-status", in: app).label,
            "No fan QR ready"
        )
        XCTAssertTrue(app.buttons["native-live-taps-create-qr"].exists,
                      "The existing session should still allow a new QR after revoking the old one.")
    }

    private func checkSignedInPrepPersistence(dropFirstResponse: Bool) throws {
        let environment = ProcessInfo.processInfo.environment
        guard let eventID = environment["PIXL_PREP_TEST_EVENT_ID"], !eventID.isEmpty,
              let itemID = environment["PIXL_PREP_TEST_ITEM_ID"], !itemID.isEmpty else {
            throw XCTSkip("Set PIXL_PREP_TEST_EVENT_ID and PIXL_PREP_TEST_ITEM_ID for a dedicated development Event Card and one of its first four Prep items. Sign in and link its owner on this simulator first.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-signed-in-prep"]
        if dropFirstResponse { app.launchArguments += ["--prep-save-lost-response-once", "--prep-hold-auto-retry"] }
        app.launch()
        defer { app.terminate() }

        openSignedInPrep(eventID: eventID, in: app)
        let itemIdentifier = "native-prep-item-\(itemID)"
        let item = assertReachable(itemIdentifier, in: app)
        let originalValue = item.value as? String
        XCTAssertEqual(originalValue, "Not ready", "Prepare an unchecked task so this test checks it off.")
        let changedValue = "Ready"
        let originalProgress = assertReachable("native-prep-checklist-toggle", in: app).value as? String ?? ""
        XCTAssertFalse(assertReachable("native-prep-save", in: app).isEnabled,
                       "Start with saved Prep and no unresolved pending command.")
        reachableFromAbove(itemIdentifier, in: app).tap()
        XCTAssertEqual(item.value as? String, changedValue)
        let changedProgress = assertReachable("native-prep-checklist-toggle", in: app).value as? String ?? ""
        XCTAssertNotEqual(changedProgress, originalProgress)
        let save = assertReachable("native-prep-save", in: app)

        if dropFirstResponse {
            let error = app.descendants(matching: .any)["native-tool-save-error"].firstMatch
            XCTAssertTrue(error.waitForExistence(timeout: 10))
            XCTAssertTrue(error.label.contains("Test server committed Prep"))
            XCTAssertTrue(error.label.contains("response dropped before acknowledgement"))
            XCTAssertTrue(error.label.contains("saved on this iPhone"))
            XCTAssertTrue(app.descendants(matching: .any)["native-tool-pending"].exists)
            XCTAssertFalse(save.isEnabled, "Use the retained-command retry, not a new save.")
            XCTAssertTrue(reachableFromAbove(itemIdentifier, in: app).isEnabled,
                          "Durably queued work must not prevent another local checklist edit.")
            XCTAssertEqual(item.value as? String, changedValue, "Failure must retain the checkoff.")
            let pendingMutation = assertReachable("native-tool-save-retry", in: app)
            XCTAssertTrue(pendingMutation.isEnabled)
            let mutationID = pendingMutation.value as? String
            XCTAssertNotNil(mutationID, "Debug test hook should expose the journaled mutation ID to XCTest.")
            XCTAssertFalse(mutationID?.isEmpty ?? true)

            // A process restart must restore the command from its account/event
            // journal, not from the editor's in-memory state.
            app.terminate()
            app.launch()
            openSignedInPrep(eventID: eventID, in: app)
            XCTAssertEqual(assertReachable(itemIdentifier, in: app).value as? String, changedValue)
        }

        waitForPrepSavedAfterChange(in: app)
        reopenSignedInPrep(eventID: eventID, in: app)
        XCTAssertEqual(assertReachable(itemIdentifier, in: app).value as? String, changedValue,
                       "Fresh Event Details must load the server-confirmed checkoff.")
        XCTAssertEqual(
            assertReachable("native-prep-checklist-toggle", in: app).value as? String,
            changedProgress
        )
        let saveButton = assertReachable("native-prep-save", in: app)
        XCTAssertEqual(saveButton.label, "Save")
        let header = app.buttons["native-prep-checklist-toggle"]
        XCTAssertTrue(header.exists)
        XCTAssertEqual(saveButton.frame.midY, header.frame.midY, accuracy: 2,
                       "Save must stay in the prep header beside the checklist chevron.")
        XCTAssertFalse(saveButton.isEnabled)
        XCTAssertFalse(app.descendants(matching: .any)["native-tool-save-error"].exists)

        // Restore the dedicated test item and verify that write too. Never
        // delete a card, clear all defaults, or modify a user's other tasks.
        reachableFromAbove(itemIdentifier, in: app).tap()
        waitForPrepSavedAfterChange(in: app)
        reopenSignedInPrep(eventID: eventID, in: app)
        XCTAssertEqual(assertReachable(itemIdentifier, in: app).value as? String, originalValue)
        XCTAssertEqual(
            assertReachable("native-prep-checklist-toggle", in: app).value as? String,
            originalProgress
        )
    }

    func testSignedInShareChoicesAtNarrowWidthAndAccessibilitySizes() throws {
        for accessibility in [false, true] {
            try checkSignedInShareChoices(accessibility: accessibility, privateCard: false)
        }
    }

    func testSignedInEventShareDraftContainsCompleteLongVenue() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let eventID = environment["PIXL_SHARE_TEST_EVENT_ID"], !eventID.isEmpty,
              let expectedLocation = environment["PIXL_SHARE_TEST_LOCATION"], !expectedLocation.isEmpty else {
            throw XCTSkip("Set PIXL_SHARE_TEST_EVENT_ID and PIXL_SHARE_TEST_LOCATION for a dedicated development Event Card with a long venue name. Sign in and link its owner on this simulator first.")
        }
        XCTAssertGreaterThanOrEqual(
            expectedLocation.count, 40,
            "Use a long venue name so this check can catch truncation."
        )

        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-share-narrow"]
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.descendants(matching: .any)["dashboard-upcoming-section"].waitForExistence(timeout: 30),
                      "Sign in and link the dedicated development owner before running this real-session test.")
        let eventCard = app.buttons.matching(NSPredicate(
            format: "identifier == %@ OR identifier == %@",
            "dashboard-event-tile-\(eventID)", "dashboard-event-card-\(eventID)"
        )).firstMatch
        for _ in 0..<20 where !eventCard.isHittable { app.swipeUp() }
        XCTAssertTrue(eventCard.isHittable, "The configured development Event Card must be reachable.")
        eventCard.tap()
        XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 15))

        let date = shareDetailValue("event-detail-date", in: app)
        let time = shareDetailValue("event-detail-time", in: app)
        let location = shareDetailValue("event-detail-location", in: app)
        XCTAssertEqual(location, expectedLocation,
                       "The dedicated Event Card must contain the exact long venue configured for this check.")

        app.buttons["event-card-share"].tap()
        assertSelectedStep("Share", in: app)
        revealShareAction("native-event-share-details", in: app).tap()

        let messagesActivity = app.descendants(matching: .any).matching(
            NSPredicate(format: "label ==[c] %@", "Messages")
        ).firstMatch
        XCTAssertTrue(messagesActivity.waitForExistence(timeout: 10),
                      "Choose Messages from the native share sheet to inspect an unsent local draft.")
        messagesActivity.tap()

        let messages = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        XCTAssertTrue(messages.navigationBars["New Message"].waitForExistence(timeout: 15),
                      "Messages should open a draft without selecting a recipient.")
        let shareTextPrefix = "PIXL SPORTS ·"
        let messageBody = messages.textViews.matching(
            NSPredicate(format: "value CONTAINS %@", shareTextPrefix)
        ).firstMatch
        XCTAssertTrue(messageBody.waitForExistence(timeout: 15),
                      "Messages should receive the event share text in its draft body.")
        let receivedDraft = (messageBody.value as? String) ?? messageBody.label
        XCTAssertTrue(receivedDraft.contains(fullShareDate(from: date)),
                      "The received draft must contain the full event date.")
        XCTAssertTrue(receivedDraft.contains(time),
                      "The received draft must contain the event time.")
        XCTAssertTrue(receivedDraft.contains(expectedLocation),
                      "The received draft must contain the complete long venue name.")

        let sendButton = messages.buttons["Send"].firstMatch
        XCTAssertTrue(sendButton.exists, "The Messages draft should expose its normal Send control.")
        XCTAssertFalse(sendButton.isEnabled,
                       "No recipient is selected, so the draft cannot be sent to anyone.")
        retainShareScreenshot(in: messages, name: "Unsent event details draft with full venue")

        let cancel = messages.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.exists)
        cancel.tap()
        let deleteDraft = messages.alerts.buttons["Delete Draft"].firstMatch
        if deleteDraft.waitForExistence(timeout: 3) {
            deleteDraft.tap()
        }
    }

    func testSignedInEventShareDraftWithoutVenueKeepsDateAndTime() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let eventID = environment["PIXL_SHARE_TEST_NO_VENUE_EVENT_ID"], !eventID.isEmpty,
              let staleLocation = environment["PIXL_SHARE_TEST_STALE_LOCATION"], !staleLocation.isEmpty else {
            throw XCTSkip("Set PIXL_SHARE_TEST_NO_VENUE_EVENT_ID and PIXL_SHARE_TEST_STALE_LOCATION for a dedicated development Event Card with no venue. Sign in and link its owner on this simulator first.")
        }

        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-share-narrow"]
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.descendants(matching: .any)["dashboard-upcoming-section"].waitForExistence(timeout: 30),
                      "Sign in and link the dedicated development owner before running this real-session test.")
        let eventCard = app.buttons.matching(NSPredicate(
            format: "identifier == %@ OR identifier == %@",
            "dashboard-event-tile-\(eventID)", "dashboard-event-card-\(eventID)"
        )).firstMatch
        for _ in 0..<20 where !eventCard.isHittable { app.swipeUp() }
        XCTAssertTrue(eventCard.isHittable, "The configured development Event Card must be reachable.")
        eventCard.tap()
        XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 15))

        let date = shareDetailValue("event-detail-date", in: app)
        let time = shareDetailValue("event-detail-time", in: app)
        let location = shareDetailValue("event-detail-location", in: app)
        XCTAssertEqual(location, "Location to be announced",
                       "The dedicated Event Card must have no saved venue.")

        app.buttons["event-card-share"].tap()
        assertSelectedStep("Share", in: app)
        revealShareAction("native-event-share-details", in: app).tap()

        let messagesActivity = app.descendants(matching: .any).matching(
            NSPredicate(format: "label ==[c] %@", "Messages")
        ).firstMatch
        XCTAssertTrue(messagesActivity.waitForExistence(timeout: 10),
                      "Choose Messages from the native share sheet to inspect an unsent local draft.")
        messagesActivity.tap()

        let messages = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        XCTAssertTrue(messages.navigationBars["New Message"].waitForExistence(timeout: 15),
                      "Messages should open a draft without selecting a recipient.")
        let shareTextPrefix = "PIXL SPORTS ·"
        let messageBody = messages.textViews.matching(
            NSPredicate(format: "value CONTAINS %@", shareTextPrefix)
        ).firstMatch
        XCTAssertTrue(messageBody.waitForExistence(timeout: 15),
                      "Messages should receive the event share text in its draft body.")
        let receivedDraft = (messageBody.value as? String) ?? messageBody.label
        XCTAssertTrue(receivedDraft.contains(fullShareDate(from: date)),
                      "The received draft must contain the full event date.")
        XCTAssertTrue(receivedDraft.contains(time),
                      "The received draft must contain the event time.")
        XCTAssertFalse(receivedDraft.contains("Location:"),
                       "A missing venue must not leave an empty location line in the draft.")
        XCTAssertFalse(receivedDraft.localizedCaseInsensitiveContains(staleLocation),
                       "A missing venue must not reuse the previous event's location.")

        let sendButton = messages.buttons["Send"].firstMatch
        XCTAssertTrue(sendButton.exists, "The Messages draft should expose its normal Send control.")
        XCTAssertFalse(sendButton.isEnabled,
                       "No recipient is selected, so the draft cannot be sent to anyone.")
        retainShareScreenshot(in: messages, name: "Unsent event details draft without venue")

        let cancel = messages.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.exists)
        cancel.tap()
        let deleteDraft = messages.alerts.buttons["Delete Draft"].firstMatch
        if deleteDraft.waitForExistence(timeout: 3) {
            deleteDraft.tap()
        }
    }

    func testSignedInReviewKeepsPrivateHypeCardUnpublished() throws {
        try checkSignedInShareChoices(accessibility: true, privateCard: true)
    }

    private func checkSignedInShareChoices(accessibility: Bool, privateCard: Bool) throws {
        let environment = ProcessInfo.processInfo.environment
        guard let eventID = environment["PIXL_SHARE_TEST_EVENT_ID"], !eventID.isEmpty,
              let athleteName = environment["PIXL_SHARE_TEST_ATHLETE_NAME"], !athleteName.isEmpty else {
            throw XCTSkip("Set PIXL_SHARE_TEST_EVENT_ID and PIXL_SHARE_TEST_ATHLETE_NAME for a dedicated development account with an upcoming Event Card. Sign in and link its owner on this simulator first.")
        }

        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-share-narrow"]
        if accessibility {
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"
            ]
        }
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.descendants(matching: .any)["dashboard-upcoming-section"].waitForExistence(timeout: 30),
                      "Sign in and link the dedicated development owner before running this real-session test.")
        let dashboardHypeCard = app.descendants(matching: .any)["dashboard-hype-card"].firstMatch
        XCTAssertTrue(dashboardHypeCard.waitForExistence(timeout: 10))
        XCTAssertTrue(dashboardHypeCard.label.contains(athleteName),
                      "The connected account must select the athlete expected by this test.")

        let eventCard = app.buttons.matching(NSPredicate(
            format: "identifier == %@ OR identifier == %@",
            "dashboard-event-tile-\(eventID)", "dashboard-event-card-\(eventID)"
        )).firstMatch
        for _ in 0..<20 where !eventCard.isHittable { app.swipeUp() }
        XCTAssertTrue(eventCard.isHittable, "The configured development Event Card must be reachable.")
        eventCard.tap()
        XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 15))

        let detailsScroll = app.scrollViews["event-detail-scroll"]
        XCTAssertTrue(detailsScroll.waitForExistence(timeout: 10))
        XCTAssertLessThanOrEqual(detailsScroll.frame.width, 320.5,
                                  "The signed-in destination must use the narrow 320-point layout.")
        let date = shareDetailValue("event-detail-date", in: app)
        let time = shareDetailValue("event-detail-time", in: app)
        let location = shareDetailValue("event-detail-location", in: app)
        XCTAssertFalse(location.isEmpty, "Use an Event Card with a saved location.")

        app.buttons["event-card-share"].tap()
        assertSelectedStep("Share", in: app)

        let sharePanel = app.descendants(matching: .any)["event-detail-tool-panel"].firstMatch
        XCTAssertTrue(sharePanel.waitForExistence(timeout: 10))
        XCTAssertFalse(sharePanel.staticTexts[fullShareDate(from: date)].exists,
                       "Share should not repeat the date already shown in the hero.")
        XCTAssertFalse(sharePanel.staticTexts[time].exists,
                       "Share should not repeat the time already shown in the hero.")
        XCTAssertFalse(sharePanel.staticTexts[location].exists,
                       "Share should not repeat the location already shown in the hero.")

        var shareDetails = revealShareAction("native-event-share-details", in: app)
        XCTAssertEqual(shareDetails.label, "Share event details")
        if !accessibility {
            XCTAssertLessThan(shareDetails.frame.height, 84,
                              "The normal-size share action should stay compact.")
        }
        XCTAssertTrue(shareDetails.isEnabled)
        XCTAssertGreaterThanOrEqual(shareDetails.frame.height, 44)
        var shareHypeCard = revealShareAction("native-event-share-hype-card", in: app)
        XCTAssertTrue(shareHypeCard.isEnabled)
        XCTAssertGreaterThanOrEqual(shareHypeCard.frame.height, 44)
        XCTAssertLessThanOrEqual(shareDetails.frame.width, detailsScroll.frame.width)
        XCTAssertLessThanOrEqual(shareHypeCard.frame.width, detailsScroll.frame.width)

        let dateForShare = fullShareDate(from: date)
        shareDetails = revealShareAction("native-event-share-details", in: app)
        shareDetails.tap()
        assertShareSheetContains(dateForShare, in: app)
        assertShareSheetContains(time, in: app)
        assertShareSheetContains(location, in: app)
        retainShareScreenshot(in: app, name: "Event details — \(accessibility ? "AX XXXL" : "default")")
        dismissShareSheet(in: app)

        shareHypeCard = revealShareAction("native-event-share-hype-card", in: app)
        shareHypeCard.tap()
        XCTAssertTrue(app.navigationBars["HYPE Card"].waitForExistence(timeout: 15))

        if privateCard {
            let card = app.descendants(matching: .any)["native-hype-card"]
            XCTAssertTrue(card.waitForExistence(timeout: 15),
                          "The linked owner can review the selected athlete’s private HYPE Card.")
            XCTAssertTrue(app.staticTexts["native-hype-card-private-preview"].exists,
                          "The preview is clearly marked as private.")
            XCTAssertFalse(app.buttons["native-hype-card-share"].exists,
                           "A private preview must not offer public sharing.")
            XCTAssertFalse(app.buttons["native-hype-card-side-videos"].exists)
            XCTAssertFalse(app.buttons["native-hype-card-side-stats"].exists)
            XCTAssertFalse(app.buttons["native-hype-card-side-events"].exists)
            XCTAssertTrue(app.descendants(matching: .any)["native-hype-card-owner-settings"].exists,
                          "The linked owner can manage the selected HYPE Card.")
            XCTAssertTrue(app.switches["native-hype-card-toggle-public"].exists,
                          "Visibility controls are present for the owner, not the public card.")
            XCTAssertTrue(app.textFields["native-hype-card-favorite-moment"].exists,
                          "The owner can edit the card’s supported favorite-moment content.")
            let refresh = app.buttons["native-hype-card-refresh"]
            XCTAssertTrue(refresh.waitForExistence(timeout: 10),
                          "Families can refresh the private preview while it is open.")
            XCTAssertTrue(refresh.isEnabled)
            refresh.tap()
            XCTAssertTrue(card.waitForExistence(timeout: 15),
                          "Refreshing keeps the owner-only preview available.")
            XCTAssertTrue(app.staticTexts["native-hype-card-private-preview"].exists,
                          "Refreshing does not change the private card’s visibility.")
            XCTAssertFalse(app.buttons["native-hype-card-share"].exists,
                           "Refreshing a private card must not add a public sharing action.")
        } else {
            let card = app.descendants(matching: .any)["native-hype-card"]
            XCTAssertTrue(card.waitForExistence(timeout: 15), "The selected athlete’s HYPE Card must load.")
            XCTAssertTrue(card.label.contains(athleteName),
                          "The Event Card action must open the selected athlete’s HYPE Card.")
            let flipContainer = app.descendants(matching: .any)["native-hype-card-flip-container"]
            XCTAssertTrue(flipContainer.exists, "The card and its section tabs form one connected surface.")
            XCTAssertTrue(app.buttons["native-hype-card-share"].exists,
                          "Sharing remains an explicit action after reviewing the card.")
            XCTAssertTrue(app.buttons["native-hype-card-side-front"].exists)
            let videosTab = app.buttons["native-hype-card-side-videos"]
            XCTAssertTrue(videosTab.exists)
            XCTAssertGreaterThanOrEqual(videosTab.frame.minY, card.frame.maxY - 1,
                                        "Section tabs sit below the HYPE Card.")
            videosTab.tap()
            XCTAssertTrue(app.descendants(matching: .any)["native-hype-card-videos"].waitForExistence(timeout: 5),
                          "The HYPE Card exposes its native Videos side.")
            XCTAssertTrue(app.descendants(matching: .any)["native-hype-card-owner-settings"].exists,
                          "Owner settings stay available while reviewing a public card.")
            for (side, content) in [
                ("stats", "native-hype-card-stats"),
                ("events", "native-hype-card-events"),
            ] {
                let tab = app.buttons["native-hype-card-side-\(side)"]
                if tab.exists {
                    let ready = XCTNSPredicateExpectation(
                        predicate: NSPredicate(format: "isEnabled == true"),
                        object: tab
                    )
                    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed,
                                   "Wait for the previous card flip to finish.")
                    tab.tap()
                    XCTAssertTrue(app.descendants(matching: .any)[content].waitForExistence(timeout: 5),
                                  "The enabled \(side) side should appear on the flipped card.")
                }
            }
            let frontTab = app.buttons["native-hype-card-side-front"]
            let frontReady = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "isEnabled == true"),
                object: frontTab
            )
            XCTAssertEqual(XCTWaiter.wait(for: [frontReady], timeout: 5), .completed)
            frontTab.tap()
        }
        XCTAssertFalse(app.otherElements["ActivityListView"].exists,
                       "Opening the HYPE Card must not launch another share sheet.")
        retainShareScreenshot(in: app, name: "HYPE Card — \(privateCard ? "private" : "available")")
    }

    private func shareDetailValue(_ identifier: String, in app: XCUIApplication) -> String {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(identifier)")
        let label = assertReachable(identifier, in: app).label
        guard let separator = label.range(of: ", ") else {
            XCTFail("Expected a labeled event detail in \(label)")
            return ""
        }
        return String(label[separator.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func fullShareDate(from compactDate: String) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(secondsFromGMT: 0)
        parser.dateFormat = "MMM d, yyyy"
        guard let date = parser.date(from: compactDate) else {
            XCTFail("Could not parse the Event Card date \(compactDate)")
            return compactDate
        }
        parser.dateFormat = "EEEE, MMMM d, yyyy"
        return parser.string(from: date)
    }

    private func revealShareAction(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.buttons[identifier].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(identifier)")
        let scroll = app.scrollViews["event-detail-scroll"]
        let viewport = scroll.frame.insetBy(dx: 1, dy: 2)
        for _ in 0..<30 {
            if element.isHittable && viewport.contains(element.frame) { break }
            let frame = element.frame
            let scrollUp = frame.maxY > viewport.maxY
            let start = scroll.coordinate(
                withNormalizedOffset: CGVector(dx: 0.5, dy: scrollUp ? 0.8 : 0.2)
            )
            let end = scroll.coordinate(
                withNormalizedOffset: CGVector(dx: 0.5, dy: scrollUp ? 0.2 : 0.8)
            )
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(element.isHittable, "\(identifier) must remain reachable in the narrow share section.")
        XCTAssertGreaterThanOrEqual(element.frame.width, 44)
        XCTAssertGreaterThanOrEqual(element.frame.height, 44)
        assertContained(element.frame, in: scroll.frame)
        return element
    }

    private func assertShareSheetContains(_ value: String, in app: XCUIApplication) {
        XCTAssertFalse(value.isEmpty)
        let match = NSPredicate(format: "label CONTAINS[c] %@", value)
        let appContent = app.descendants(matching: .any).matching(match).firstMatch
        if appContent.waitForExistence(timeout: 5) { return }

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let systemContent = springboard.descendants(matching: .any).matching(match).firstMatch
        XCTAssertTrue(systemContent.waitForExistence(timeout: 10),
                      "The iOS share sheet must include \(value).")
    }

    private func dismissShareSheet(in app: XCUIApplication) {
        let close = app.buttons["Close"].firstMatch
        if close.waitForExistence(timeout: 3) {
            close.tap()
            XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 5))
            return
        }
        let activityList = app.otherElements["ActivityListView"].firstMatch
        XCTAssertTrue(activityList.waitForExistence(timeout: 5),
                      "The native iOS share sheet should be open.")
        activityList.swipeDown()
        XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 5))
    }

    private func retainShareScreenshot(in app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Share choices — \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func openSignedInPrep(eventID: String, in app: XCUIApplication) {
        XCTAssertTrue(app.descendants(matching: .any)["dashboard-upcoming-section"].waitForExistence(timeout: 30),
                      "Sign in and link the dedicated development owner; its Event Card must be in the upcoming list.")
        // Normal text uses grid tiles; accessibility text uses expanded cards.
        let card = app.buttons.matching(NSPredicate(
            format: "identifier == %@ OR identifier == %@",
            "dashboard-event-tile-\(eventID)", "dashboard-event-card-\(eventID)"
        )).firstMatch
        for _ in 0..<20 where !card.isHittable { app.swipeUp() }
        XCTAssertTrue(card.isHittable, "The configured development Event Card must be reachable.")
        card.tap()
        XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 15))
        app.buttons["event-card-prep"].tap()
        _ = assertReachable("native-prep-checklist-toggle", in: app)
        XCTAssertFalse(app.buttons["prep-test-open-event"].exists)
        XCTAssertFalse(app.buttons["prep-test-advance-clock"].exists)
    }

    private func waitForPrepSaved(in app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["Prep saved"].waitForExistence(timeout: 30),
                      "Saving must receive the authenticated server acknowledgement.")
        XCTAssertFalse(app.staticTexts["Unsaved changes"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["native-tool-save-error"].exists)
        XCTAssertFalse(assertReachable("native-prep-save", in: app).isEnabled)
    }

    private func waitForPrepSavedAfterChange(in app: XCUIApplication) {
        let unsaved = app.staticTexts["Unsaved changes"]
        let changesSettled = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: unsaved
        )
        XCTAssertEqual(XCTWaiter.wait(for: [changesSettled], timeout: 30), .completed,
                       "Checklist edits should save without requiring a manual Save tap.")
        waitForPrepSaved(in: app)
    }

    private func reopenSignedInPrep(eventID: String, in app: XCUIApplication) {
        eventNavigationBar(in: app).buttons.firstMatch.tap()
        XCTAssertFalse(app.buttons["Leave without saving"].exists,
                       "An acknowledged save must clear the dirty-navigation warning.")
        openSignedInPrep(eventID: eventID, in: app)
    }

    func testUnsavedPrepSurvivesTimelineRecommendationsAndBackgroundResume() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail", "--ui-testing-prep-draft"]
        app.launch()
        let openEvent = app.buttons["prep-test-open-event"]
        XCTAssertTrue(openEvent.waitForExistence(timeout: 10))
        openEvent.tap()

        let recommendation = app.staticTexts["event-detail-recommended-step"]
        XCTAssertTrue(recommendation.waitForExistence(timeout: 10))
        XCTAssertEqual(recommendation.label, "Next: Prep")
        assertRecommendedStep("Prep", in: app)
        app.buttons["event-card-prep"].tap()
        assertSelectedStep("Prep", in: app)

        let quickWater = assertReachable("native-prep-item-water", in: app)
        XCTAssertEqual(quickWater.value as? String, "Not ready")
        quickWater.tap()
        XCTAssertEqual(quickWater.value as? String, "Ready")
        XCTAssertTrue(
            (assertReachable("native-prep-checklist-toggle", in: app).value as? String ?? "")
                .contains("1 of 2 ready")
        )
        app.buttons["native-prep-manage-full"].tap()

        let water = assertReachable("native-prep-item-water", in: app)
        XCTAssertEqual(water.value as? String, "Ready", "Quick checklist edits must carry into full Prep.")
        assertReachable("native-prep-back-to-content", in: app).tap()
        XCTAssertEqual(
            assertReachable("native-prep-item-water", in: app).value as? String,
            "Ready",
            "Returning to Content must preserve the quick checklist edit."
        )
        assertReachable("native-prep-manage-full", in: app).tap()
        let addTask = assertReachable("native-prep-add-task", in: app)
        addTask.tap()
        addTask.typeText("Bring spare socks")
        app.buttons["native-prep-add"].tap()
        let addedTask = app.buttons.matching(
            NSPredicate(format: "label == %@", "Bring spare socks")
        ).firstMatch
        XCTAssertTrue(addedTask.waitForExistence(timeout: 5))
        addedTask.tap()

        let notes = assertReachable("native-prep-notes", in: app)
        notes.tap()
        notes.typeText(" unsaved draft ")
        // A tap can place the caret anywhere in the saved note. Preserve the
        // exact resulting text rather than assuming an end-of-field caret.
        let draftNotes = notes.value as? String ?? ""
        XCTAssertTrue(draftNotes.contains(" unsaved draft "))
        XCTAssertTrue(assertReachable("native-prep-save", in: app).isEnabled)

        // The clock control only changes an offset. The production TimelineView
        // must deliver its next periodic tick to update this diagnostic.
        let ticks = app.staticTexts["prep-test-timeline-ticks"]
        let previousTicks = Int(ticks.label) ?? 0
        reachableFromAbove("prep-test-advance-clock", in: app).tap()
        assertLabel("Next: Track Stats", identifier: "prep-test-recommendation", in: app, timeout: 25)
        assertRecommendedStep("Track Stats", in: app)
        XCTAssertGreaterThan(Int(ticks.label) ?? 0, previousTicks)
        app.buttons["event-card-track-stats"].tap()
        app.buttons["event-card-prep"].tap()
        assertDraftRemains(in: app, notes: draftNotes, addedTask: addedTask)

        // Change guidance while the app is away as well. Do not relaunch: this
        // checks a living SwiftUI navigation stack and its in-memory draft.
        reachableFromAbove("prep-test-advance-clock", in: app).tap()
        let resumes = Int(app.staticTexts["prep-test-resumes"].label) ?? 0
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5))
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
        let resumed = NSPredicate { _, _ in
            (Int(app.staticTexts["prep-test-resumes"].label) ?? 0) > resumes
        }
        expectation(for: resumed, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        assertLabel("Next: Share", identifier: "prep-test-recommendation", in: app, timeout: 25)
        assertRecommendedStep("Share", in: app)
        assertDraftRemains(in: app, notes: draftNotes, addedTask: addedTask)

        eventNavigationBar(in: app).buttons["Back"].tap()
        let discard = app.buttons["Leave without saving"]
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        XCTAssertTrue(eventNavigationBar(in: app).exists, "Requesting Back must not pop the dirty editor")
        app.buttons["Cancel"].tap()
        XCTAssertFalse(discard.exists)
        assertDraftRemains(in: app, notes: draftNotes, addedTask: addedTask)

        eventNavigationBar(in: app).buttons["Back"].tap()
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        discard.tap()
        XCTAssertTrue(openEvent.waitForExistence(timeout: 5))
        XCTAssertFalse(eventNavigationBar(in: app).exists)

        // Discarding is not an implicit save. Reopening starts from the same
        // saved fixture, rather than the abandoned local draft.
        openEvent.tap()
        XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 5))
        XCTAssertEqual(recommendation.label, "Next: Share")
        app.buttons["event-card-prep"].tap()
        _ = assertReachable("native-prep-item-water", in: app)
        XCTAssertEqual(water.value as? String, "Not ready")
        XCTAssertFalse(addedTask.exists)
        let savedNotes = assertReachable("native-prep-notes", in: app)
        XCTAssertEqual(savedNotes.value as? String, "Saved fixture note")
        XCTAssertFalse(assertReachable("native-prep-save", in: app).isEnabled)
    }

    func testCompletingPrepCelebratesCollapsesChecklistAndAddingTaskReopensIt() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail", "--ui-testing-prep-draft"]
        app.launch()
        defer { app.terminate() }

        let openEvent = app.buttons["prep-test-open-event"]
        XCTAssertTrue(openEvent.waitForExistence(timeout: 10))
        openEvent.tap()
        XCTAssertTrue(app.buttons["event-card-prep"].waitForExistence(timeout: 10))
        app.buttons["event-card-prep"].tap()

        assertReachable("native-prep-item-water", in: app).tap()
        assertReachable("native-prep-item-cleats", in: app).tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["native-prep-completion-celebration"]
                .waitForExistence(timeout: 5)
        )
        let checklist = assertReachable("native-prep-checklist-toggle", in: app)
        XCTAssertTrue(checklist.label.localizedCaseInsensitiveContains("prep"))
        XCTAssertFalse(app.staticTexts["Your checklist"].exists)
        XCTAssertTrue((checklist.value as? String ?? "").contains("Collapsed"))
        XCTAssertFalse(app.buttons["native-prep-item-water"].exists)

        assertReachable("native-prep-manage-full", in: app).tap()
        let addTask = assertReachable("native-prep-add-task", in: app)
        addTask.tap()
        addTask.typeText("Bring a team banner")
        app.buttons["native-prep-add"].tap()
        assertReachable("native-prep-back-to-content", in: app).tap()

        let reopenedChecklist = assertReachable("native-prep-checklist-toggle", in: app)
        XCTAssertTrue((reopenedChecklist.value as? String ?? "").contains("Expanded"))
        let addedTask = app.buttons.matching(NSPredicate(
            format: "label == %@", "Bring a team banner"
        )).firstMatch
        XCTAssertTrue(addedTask.waitForExistence(timeout: 5))
        XCTAssertEqual(addedTask.value as? String, "Not ready")
    }

    func testCompactPrepLongLabelsAtNarrowDefaultWidth() throws {
        try checkCompactPrepLongLabels(accessibility: false)
    }

    func testCompactPrepLongLabelsAtNarrowAccessibilityXXXLWidth() throws {
        try checkCompactPrepLongLabels(accessibility: true)
    }

    private func checkCompactPrepLongLabels(accessibility: Bool) throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-event-detail", "--ui-testing-prep-draft", "--prep-long-labels"
        ]
        if accessibility {
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"
            ]
        }
        app.launch()
        defer { app.terminate() }
        let openEvent = app.buttons["prep-test-open-event"]
        XCTAssertTrue(openEvent.waitForExistence(timeout: 10))
        openEvent.tap()
        XCTAssertTrue(app.buttons["event-card-prep"].waitForExistence(timeout: 10))
        app.buttons["event-card-prep"].tap()

        let tasks = [
            ("water", "Pack enough water for warmups and the whole game"),
            ("cleats", "Bring cleats and spare socks for the muddy field"),
            ("uniform", "Pack the full uniform with both home and away jerseys"),
            ("arrival", "Confirm the field entrance and warmup arrival time")
        ]
        let scroll = app.scrollViews["event-detail-scroll"]
        XCTAssertTrue(scroll.exists)
        XCTAssertLessThanOrEqual(scroll.frame.width, 320.5)
        for (index, task) in tasks.enumerated() {
            let row = revealPrepControl("native-prep-item-\(task.0)", in: app)
            XCTAssertEqual(row.label, task.1, "VoiceOver must receive the complete task label")
            XCTAssertEqual(row.value as? String, "Not ready")
            XCTAssertTrue(row.isEnabled)
            if accessibility {
                XCTAssertGreaterThan(row.frame.height, 60, "Long labels must expand into multiple lines")
            }
            if index > 0 {
                let previous = app.buttons["native-prep-item-\(tasks[index - 1].0)"]
                XCTAssertLessThanOrEqual(previous.frame.maxY, row.frame.minY,
                                         "Wrapped checklist hit areas must not overlap")
            }
            try auditPrepControl(row, in: app)
            retainPrepScreenshot(in: app, name: "\(task.0) — \(accessibility ? "AX XXXL" : "default")")
            row.tap()
            XCTAssertEqual(row.value as? String, "Ready")
            XCTAssertTrue(
                (assertReachable("native-prep-checklist-toggle", in: app).value as? String ?? "")
                    .contains("\(index + 1) of 5 ready")
            )
        }
        let fifthInContent = revealPrepControl("native-prep-item-snack", in: app)
        XCTAssertEqual(fifthInContent.value as? String, "Not ready",
                       "The full checklist should be available in Event Details.")
        let manage = revealPrepControl("native-prep-manage-full", in: app)
        XCTAssertEqual(manage.label, "Manage tasks and event notes")
        XCTAssertLessThanOrEqual(app.buttons["native-prep-item-snack"].frame.maxY, manage.frame.minY)
        try auditPrepControl(manage, in: app)
        retainPrepScreenshot(in: app, name: "Manage tasks and notes — \(accessibility ? "AX XXXL" : "default")")
        manage.tap()

        // Both presentations edit the same in-memory draft, never a fixture save.
        for task in tasks {
            XCTAssertEqual(app.buttons["native-prep-item-\(task.0)"].value as? String, "Ready")
        }
        let fifth = revealPrepControl("native-prep-item-snack", in: app)
        XCTAssertEqual(fifth.value as? String, "Not ready")
        fifth.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["native-prep-completion-celebration"]
                .waitForExistence(timeout: 5)
        )
        let notes = revealPrepControl("native-prep-notes", in: app)
        notes.tap()
        notes.typeText(" local draft ")
        let draftNotes = notes.value as? String ?? ""
        XCTAssertTrue(draftNotes.contains(" local draft "))

        // The production step actions dismiss the keyboard without saving.
        app.buttons["event-card-share"].tap()
        app.buttons["event-card-prep"].tap()
        let back = revealPrepControl("native-prep-back-to-content", in: app)
        XCTAssertEqual(back.label, "Back to Content")
        try auditPrepControl(back, in: app)
        retainPrepScreenshot(in: app, name: "Back to Content — \(accessibility ? "AX XXXL" : "default")")
        back.tap()
        let checklist = revealPrepControl("native-prep-checklist-toggle", in: app)
        XCTAssertTrue((checklist.value as? String ?? "").contains("Collapsed"))
        checklist.tap()
        _ = revealPrepControl("native-prep-item-water", in: app)
        XCTAssertTrue(
            (revealPrepControl("native-prep-checklist-toggle", in: app).value as? String ?? "")
                .contains("5 of 5 ready")
        )
        for task in tasks {
            XCTAssertEqual(app.buttons["native-prep-item-\(task.0)"].value as? String, "Ready")
        }
        XCTAssertEqual(revealPrepControl("native-prep-item-snack", in: app).value as? String, "Ready")
        XCTAssertTrue(revealPrepControl("native-prep-save", in: app).isEnabled)
        revealPrepControl("native-prep-manage-full", in: app).tap()
        revealPrepControl("native-prep-checklist-toggle", in: app).tap()
        XCTAssertEqual(revealPrepControl("native-prep-item-snack", in: app).value as? String, "Ready")
        XCTAssertEqual(revealPrepControl("native-prep-notes", in: app).value as? String, draftNotes,
                       "Returning to Content and reopening full Prep must not reload saved notes")
    }

    // isHittable alone can pass for a clipped row. Bring the entire control
    // inside the scroll viewport above the fixed step bar, using short drags
    // near the target so a tall wrapped row is not repeatedly overscrolled.
    @discardableResult
    private func revealPrepControl(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(identifier)")
        let scroll = app.scrollViews["event-detail-scroll"]
        let viewport = scroll.frame.insetBy(dx: 0, dy: 4)
        for _ in 0..<40 {
            let frame = element.frame
            if frame.minY >= viewport.minY && frame.maxY <= viewport.maxY && element.isHittable { break }
            let up = frame.maxY > viewport.maxY
            let distance = up ? frame.maxY - viewport.maxY + 8 : viewport.minY - frame.minY + 8
            let fraction = min(0.6, max(0.08, distance / scroll.frame.height))
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.8 : 0.2))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.8 - fraction : 0.2 + fraction))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(element.isHittable, "\(identifier) must remain reachable")
        XCTAssertGreaterThanOrEqual(element.frame.height, 44)
        XCTAssertGreaterThanOrEqual(element.frame.width, 44)
        assertContained(element.frame, in: viewport)
        return element
    }

    private func auditPrepControl(_ control: XCUIElement, in app: XCUIApplication) throws {
        try app.performAccessibilityAudit(for: [.textClipped, .hitRegion]) { issue in
            guard let element = issue.element else { return false }
            return element.identifier == "event-detail-safe-area" || !element.frame.intersects(control.frame)
        }
    }

    private func retainPrepScreenshot(in app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Compact Prep — \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testReadOnlyDetailFixtureDoesNotExposePrivateEditorsWithoutClerk() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail"]
        app.launch()
        let prep = app.buttons["event-card-prep"]
        XCTAssertTrue(prep.waitForExistence(timeout: 10))
        XCTAssertTrue(prep.isEnabled, "Read-only fixture may switch panels, not edit private data")
        prep.tap()
        _ = assertReachable("event-detail-prep-summary", in: app)
        assertSelectedStep("Prep", in: app)
        XCTAssertFalse(app.buttons["native-prep-save"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["native-prep-notes"].exists)
        app.buttons["event-card-track-stats"].tap()
        assertSelectedStep("Track Stats", in: app)
        XCTAssertTrue(app.staticTexts["Sign in to use this event’s native tools."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["native-prep-save"].exists)
        XCTAssertFalse(app.buttons["prep-test-advance-clock"].exists)
    }

    private func assertLabel(_ label: String, identifier: String, in app: XCUIApplication, timeout: TimeInterval) {
        let element = app.staticTexts[identifier]
        expectation(for: NSPredicate(format: "label == %@", label), evaluatedWith: element)
        waitForExpectations(timeout: timeout)
    }

    private func assertDraftRemains(in app: XCUIApplication, notes: String, addedTask: XCUIElement) {
        XCTAssertTrue(eventNavigationBar(in: app).exists, "Recommendation/resume must not pop Event Details")
        _ = assertReachable("native-prep-notes", in: app)
        XCTAssertEqual(app.descendants(matching: .any)["native-prep-notes"].value as? String, notes)
        let water = reachableFromAbove("native-prep-item-water", in: app)
        XCTAssertEqual(water.value as? String, "Ready")
        XCTAssertEqual(addedTask.value as? String, "Ready")
        XCTAssertTrue(assertReachable("native-prep-save", in: app).isEnabled)
        XCTAssertTrue(app.staticTexts["Unsaved changes"].exists)
        _ = assertReachable("native-prep-notes", in: app)
    }

    @discardableResult
    private func reachableFromAbove(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        for _ in 0..<12 where !element.isHittable { app.swipeDown() }
        XCTAssertTrue(element.isHittable, "Missing or unreachable \(identifier)")
        return element
    }

    func testLongEventDetailsRemainReachableAtAccessibilityTextSize() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-event-detail",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ]
        app.launch()

        let title = app.descendants(matching: .any)["event-detail-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertTrue(title.label.contains("Championship Showcase"))
        let status = assertReachable("event-detail-status", in: app)
        XCTAssertTrue(status.label.contains("Live"))
        let date = assertReachable("event-detail-date", in: app)
        XCTAssertTrue(date.label.contains("Nov 14"))
        let time = assertReachable("event-detail-time", in: app)
        XCTAssertTrue(time.label.contains("PM"))
        let location = assertReachable("event-detail-location", in: app)
        XCTAssertTrue(location.label.contains("Field Twenty-Seven"))
        let hero = app.descendants(matching: .any)["event-detail-hero"]
        XCTAssertTrue(hero.waitForExistence(timeout: 5))
        XCTAssertTrue(hero.frame.contains(title.frame))
        XCTAssertTrue(hero.frame.contains(date.frame))
        XCTAssertTrue(hero.frame.contains(time.frame))
        XCTAssertTrue(hero.frame.contains(location.frame))
        XCTAssertGreaterThan(date.frame.minY, title.frame.minY)
        XCTAssertEqual(date.frame.minX, time.frame.minX, accuracy: 2)
        XCTAssertEqual(date.frame.minX, location.frame.minX, accuracy: 2)
        XCTAssertGreaterThan(time.frame.minY, date.frame.minY)
        XCTAssertGreaterThan(location.frame.minY, time.frame.minY)
        XCTAssertFalse(app.descendants(matching: .any)["event-detail-opponent"].exists)
        XCTAssertFalse(app.staticTexts["EVENT DETAILS"].exists)
        assertReachable("event-detail-tool-panel", in: app)
    }

    func testEventStepsAtNarrowDefaultWidth() throws {
        let app = launchStepBar()
        defer { app.terminate() }
        try assertStepBarLayout(in: app, accessibility: false, narrow: true)
    }

    func testEventStepsAtNarrowAccessibilityXXXLWidth() throws {
        let app = launchStepBar(accessibility: true)
        defer { app.terminate() }
        try assertStepBarLayout(in: app, accessibility: true, narrow: true)
    }

    func testEventStepsInBothLandscapeDirectionsAndAfterReturningToPortrait() throws {
        try checkLandscapeStepBar(accessibility: false)
    }

    func testEventStepsInLandscapeAtAccessibilityXXXL() throws {
        try checkLandscapeStepBar(accessibility: true)
    }

    func testPracticeKeepsDisabledStatsReadableAtNarrowAndLandscapeAccessibilityXXXL() throws {
        for landscape in [false, true] {
            let app = launchStepBar(accessibility: true, fullWidth: landscape, practice: true)
            if landscape { rotate(.landscapeLeft, in: app) }
            try assertStepBarLayout(in: app, accessibility: true, narrow: !landscape, practice: true)
            app.buttons["event-card-prep"].tap()
            _ = assertReachable("event-detail-prep-summary", in: app)
            let stats = app.buttons["event-card-track-stats"]
            XCTAssertFalse(stats.isEnabled, "Practice must not enable game statistics after selecting Prep")
            // Disabled controls still expose their name and recommendation metadata.
            XCTAssertEqual(stats.label, "Track Stats")
            app.buttons["event-card-share"].tap()
            XCTAssertTrue(app.navigationBars["Share"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["event-detail-prep-summary"].exists)
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
    }

    private let stepButtons = [
        ("event-card-prep", "Prep"),
        ("event-card-track-stats", "Track Stats"),
        ("event-card-share", "Share")
    ]

    private func launchStepBar(
        accessibility: Bool = false, fullWidth: Bool = false, practice: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail"]
        if fullWidth { app.launchArguments.append("--event-detail-full-width") }
        if practice { app.launchArguments.append("--event-detail-practice") }
        if accessibility {
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"
            ]
        }
        app.launch()
        XCTAssertTrue(app.buttons["event-card-prep"].waitForExistence(timeout: 10))
        return app
    }

    private func rotate(_ orientation: UIDeviceOrientation, in app: XCUIApplication) {
        XCUIDevice.shared.orientation = orientation
        let landscape = orientation == .landscapeLeft || orientation == .landscapeRight
        expectation(for: NSPredicate { _, _ in
            landscape ? app.frame.width > app.frame.height : app.frame.height > app.frame.width
        }, evaluatedWith: app)
        waitForExpectations(timeout: 10)
    }

    private func checkLandscapeStepBar(accessibility: Bool) throws {
        let app = launchStepBar(accessibility: accessibility, fullWidth: true)
        defer { app.terminate() }
        for orientation in [UIDeviceOrientation.landscapeLeft, .landscapeRight, .portrait] {
            rotate(orientation, in: app)
            try assertStepBarLayout(in: app, accessibility: accessibility, narrow: false)
        }
    }

    private func assertRecommendedStep(_ title: String, in app: XCUIApplication) {
        assertLabel("Next: \(title)", identifier: "event-detail-recommended-step", in: app, timeout: 5)
        for (identifier, label) in stepButtons {
            let button = app.buttons[identifier]
            XCTAssertEqual(button.label, label, "VoiceOver must announce the full step name")
            XCTAssertEqual(
                button.value as? String ?? "",
                label == title ? "Recommended next step" : "",
                "Only the time-recommended step should announce the recommendation, regardless of selection"
            )
        }
    }

    private func assertStepBarLayout(
        in app: XCUIApplication, accessibility: Bool, narrow: Bool, practice: Bool = false
    ) throws {
        let bar = app.otherElements["event-detail-step-bar"]
        let safeArea = app.otherElements["event-detail-safe-area"]
        let scroll = app.scrollViews["event-detail-scroll"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        XCTAssertTrue(safeArea.exists)
        XCTAssertTrue(scroll.exists)
        let safeFrame = safeArea.frame
        XCTAssertGreaterThan(safeFrame.width, 0)
        XCTAssertGreaterThan(safeFrame.height, 0)
        if narrow { XCTAssertLessThanOrEqual(bar.frame.width, 320.5) }
        assertContained(bar.frame, in: safeFrame)
        XCTAssertGreaterThan(scroll.frame.height, 44, "Details must retain a usable scroll viewport above the bar")
        XCTAssertLessThanOrEqual(scroll.frame.maxY, bar.frame.minY + 1)
        var previousFrame: CGRect?
        for (identifier, title) in stepButtons {
            let button = app.buttons[identifier]
            XCTAssertEqual(button.label, title)
            XCTAssertEqual(button.isEnabled, !(practice && title == "Track Stats"))
            XCTAssertGreaterThanOrEqual(button.frame.width, 44)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44)
            assertContained(button.frame, in: safeFrame)
            assertContained(button.frame, in: bar.frame)
            if button.isEnabled { XCTAssertTrue(button.isHittable) }
            if let previousFrame {
                XCTAssertLessThanOrEqual(previousFrame.maxX, button.frame.minX, "Step hit areas must not overlap")
            }
            previousFrame = button.frame
        }
        let recommendation = app.staticTexts["event-detail-recommended-step"].label
        XCTAssertTrue(recommendation.hasPrefix("Next: "))
        let recommendedTitle = String(recommendation.dropFirst("Next: ".count))
        assertRecommendedStep(recommendedTitle, in: app)
        if practice { XCTAssertNotEqual(recommendedTitle, "Track Stats") }

        // Checking labels alone cannot detect clipped rendered glyphs. Use Apple's
        // native audit for the bar, excluding unrelated read-only fixture content.
        try app.performAccessibilityAudit(for: [.textClipped, .hitRegion]) { issue in
            guard let element = issue.element else { return false }
            return !element.frame.intersects(bar.frame) || element.identifier == "event-detail-safe-area"
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Event step bar — \(practice ? "practice" : "game") — \(accessibility ? "AX XXXL" : "default") — \(XCUIDevice.shared.orientation.rawValue)"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        // Gesture inside the details viewport, never on the fixed step buttons.
        let title = app.descendants(matching: .any)["event-detail-title"]
        for _ in 0..<25 where !title.isHittable {
            swipeDetails(scroll, up: false)
        }
        for _ in 0..<25 where !app.descendants(matching: .any)["event-detail-date"].isHittable {
            swipeDetails(scroll, up: true)
        }
        let date = app.descendants(matching: .any)["event-detail-date"]
        let time = app.descendants(matching: .any)["event-detail-time"]
        let location = app.descendants(matching: .any)["event-detail-location"]
        XCTAssertTrue(date.isHittable, "The event date must be reachable inside the details viewport")
        XCTAssertTrue(time.exists)
        XCTAssertTrue(location.exists)
        XCTAssertGreaterThan(date.frame.minY, title.frame.minY,
                             "Schedule details should sit beneath the event identity.")
        if accessibility {
            XCTAssertEqual(date.frame.minX, time.frame.minX, accuracy: 2)
            XCTAssertEqual(date.frame.minX, location.frame.minX, accuracy: 2)
            XCTAssertGreaterThan(time.frame.minY, date.frame.minY)
            XCTAssertGreaterThan(location.frame.minY, time.frame.minY)
        } else {
            XCTAssertEqual(date.frame.minY, time.frame.minY, accuracy: 2,
                           "Date, time, and location should share one horizontal row.")
            XCTAssertEqual(date.frame.minY, location.frame.minY, accuracy: 2)
            XCTAssertLessThan(date.frame.minX, time.frame.minX)
            XCTAssertLessThan(time.frame.minX, location.frame.minX)
        }

        let initialBar = bar.frame
        let initialDateY = date.frame.minY
        swipeDetails(scroll, up: true)
        XCTAssertLessThan(date.frame.minY, initialDateY, "Event details must actually scroll")
        let panel = app.descendants(matching: .any)["event-detail-tool-panel"]
        for _ in 0..<30 where !panel.isHittable { swipeDetails(scroll, up: true) }
        XCTAssertTrue(panel.isHittable, "The final tool panel must remain reachable above the step bar")
        XCTAssertLessThan(panel.frame.minY, bar.frame.minY)
        XCTAssertEqual(bar.frame.minY, initialBar.minY, accuracy: 2)
        XCTAssertEqual(bar.frame.height, initialBar.height, accuracy: 2)
        for (identifier, _) in stepButtons where app.buttons[identifier].isEnabled {
            XCTAssertTrue(app.buttons[identifier].isHittable, "Scrolling must not hide the step actions")
        }
        // Changing selection must not move the VoiceOver recommendation.
        app.buttons[recommendedTitle == "Prep" ? "event-card-share" : "event-card-prep"].tap()
        assertRecommendedStep(recommendedTitle, in: app)
    }

    private func swipeDetails(_ scroll: XCUIElement, up: Bool) {
        let top = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
        let bottom = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        (up ? bottom : top).press(forDuration: 0.05, thenDragTo: up ? top : bottom)
    }

    private func assertContained(_ frame: CGRect, in container: CGRect) {
        XCTAssertGreaterThanOrEqual(frame.minX, container.minX - 1)
        XCTAssertGreaterThanOrEqual(frame.minY, container.minY - 1)
        XCTAssertLessThanOrEqual(frame.maxX, container.maxX + 1)
        XCTAssertLessThanOrEqual(frame.maxY, container.maxY + 1)
    }

    func testUnauthenticatedFixturePrepPreviewCannotEditSavedData() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail"]
        app.launch()
        XCTAssertTrue(app.buttons["event-card-prep"].waitForExistence(timeout: 10))
        app.buttons["event-card-prep"].tap()
        let summary = assertReachable("event-detail-prep-summary", in: app)
        XCTAssertTrue(summary.staticTexts["Read only"].exists)
        XCTAssertTrue(summary.descendants(matching: .any)["event-detail-prep-empty"].exists)
        XCTAssertFalse(summary.switches.firstMatch.exists)
        XCTAssertFalse(summary.textFields.firstMatch.exists)
        XCTAssertFalse(summary.textViews.firstMatch.exists)
        XCTAssertFalse(summary.buttons["native-prep-save"].exists)
    }

    func testStepButtonsSwitchTheSharedPanelWithoutLeavingEventDetails() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail", "--ui-testing-schedule-refresh"]
        app.launch()
        let prep = app.buttons["event-card-prep"]
        XCTAssertTrue(prep.waitForExistence(timeout: 10))
        let loadCount = app.staticTexts["schedule-refresh-detail-count"]
        XCTAssertTrue(loadCount.waitForExistence(timeout: 10))
        waitForAtLeastOneRefresh(loadCount)
        let initialDetailLoads = refreshCount(loadCount)
        prep.tap()
        assertReachable("event-detail-prep-summary", in: app)
        assertSelectedStep("Prep", in: app)
        app.buttons["event-card-share"].tap()
        assertSelectedStep("Share", in: app)
        XCTAssertTrue(eventNavigationBar(in: app).exists)
        XCTAssertFalse(app.descendants(matching: .any)["event-detail-prep-summary"].exists)
        app.buttons["event-card-track-stats"].tap()
        assertSelectedStep("Track Stats", in: app)
        app.buttons["event-card-prep"].tap()
        assertSelectedStep("Prep", in: app)
        assertReachable("event-detail-prep-summary", in: app)
        XCTAssertEqual(refreshCount(loadCount), initialDetailLoads,
                       "Changing Event Details tools must not reload the schedule.")
    }

    func testRetainedEmbeddedPrepDoesNotOverrideSelectedNavigationTitle() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail", "--ui-testing-prep-draft"]
        app.launch()
        defer { app.terminate() }

        let openEvent = app.buttons["prep-test-open-event"]
        XCTAssertTrue(openEvent.waitForExistence(timeout: 10))
        openEvent.tap()
        let prep = app.buttons["event-card-prep"]
        XCTAssertTrue(prep.waitForExistence(timeout: 10))
        prep.tap()
        _ = assertReachable("native-prep-checklist-toggle", in: app)
        assertSelectedStep("Prep", in: app)

        // Prep stays mounted to preserve drafts. Its hidden content must not
        // publish a navigation title over the newly selected page.
        for (identifier, title) in [
            ("event-card-track-stats", "Track Stats"),
            ("event-card-share", "Share"),
            ("event-card-prep", "Prep")
        ] {
            app.buttons[identifier].tap()
            assertSelectedStep(title, in: app)
        }
        _ = assertReachable("native-prep-checklist-toggle", in: app)
    }

    func testEventChangesRefreshEventDetailsExactlyOnceAndDashboardAfterClosing() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-dashboard",
            "--ui-testing-schedule-refresh",
            "--dashboard-state=upcoming"
        ]
        app.launch()

        let dashboardCount = app.staticTexts["schedule-refresh-dashboard-count"]
        XCTAssertTrue(dashboardCount.waitForExistence(timeout: 10))
        waitForAtLeastOneRefresh(dashboardCount)
        var dashboardLoads = refreshCount(dashboardCount)

        let detail = app.buttons["dashboard-message-board-card"]
        XCTAssertTrue(detail.waitForExistence(timeout: 10))
        detail.tap()
        XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 10))
        let detailCount = app.staticTexts["schedule-refresh-detail-count"]
        XCTAssertTrue(detailCount.waitForExistence(timeout: 10))
        waitForAtLeastOneRefresh(detailCount)
        var detailLoads = refreshCount(detailCount)

        for reason in ["gameStarted", "gameFinished", "liveTapsStarted"] {
            let trigger = assertReachable("schedule-change-\(reason)", in: app)
            trigger.tap()
            detailLoads += 1
            waitForRefreshCount(detailCount, expected: detailLoads)

            app.buttons["Done"].tap()
            dashboardLoads += 1
            waitForRefreshCount(dashboardCount, expected: dashboardLoads)

            detail.tap()
            XCTAssertTrue(eventNavigationBar(in: app).waitForExistence(timeout: 10))
            detailLoads += 1
            waitForRefreshCount(detailCount, expected: detailLoads)
        }

        let edit = assertReachable("schedule-change-eventCardEdited", in: app)
        edit.tap()
        detailLoads += 1
        waitForRefreshCount(detailCount, expected: detailLoads)

        app.buttons["Done"].tap()
        dashboardLoads += 1
        waitForRefreshCount(dashboardCount, expected: dashboardLoads)
        XCTAssertEqual(refreshCount(detailCount), detailLoads,
                       "The Event Card edit notification must not duplicate its editor refresh.")
    }

    private func refreshCount(_ element: XCUIElement) -> Int {
        guard let value = Int(element.label.split(separator: " ").last ?? "") else {
            XCTFail("Unexpected refresh counter label: \(element.label)")
            return -1
        }
        return value
    }

    private func waitForRefreshCount(_ element: XCUIElement, expected: Int) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "\(expected)"),
            object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
        XCTAssertEqual(refreshCount(element), expected)
    }

    private func waitForAtLeastOneRefresh(_ element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate { object, _ in
                guard let element = object as? XCUIElement else { return false }
                let lastLabelPart = element.label.split(separator: " ").last ?? ""
                return (Int(lastLabelPart) ?? 0) > 0
            },
            object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
    }

    private func assertSelectedStep(_ title: String, in app: XCUIApplication) {
        let panel = app.descendants(matching: .any)["event-detail-tool-panel"].firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.navigationBars[title].waitForExistence(timeout: 5),
            "The navigation title should identify the \(title) page."
        )
        let stepIdentifier: String
        switch title {
        case "Prep": stepIdentifier = "event-card-prep"
        case "Track Stats": stepIdentifier = "event-card-track-stats"
        case "Share": stepIdentifier = "event-card-share"
        default: XCTFail("Unexpected Event Details step \(title)"); return
        }
        let selectedStep = app.buttons[stepIdentifier]
        XCTAssertTrue(selectedStep.waitForExistence(timeout: 5))
        XCTAssertTrue(selectedStep.isSelected, "\(title) should be identified by the selected navigation step.")
        XCTAssertFalse(app.descendants(matching: .any)["event-tool-header"].exists,
                       "The selected step should not repeat an Event Card header.")
    }

    private func eventNavigationBar(in app: XCUIApplication) -> XCUIElement {
        app.navigationBars.matching(
            NSPredicate(format: "label IN %@", ["Prep", "Track Stats", "Share"])
        ).firstMatch
    }

    func testLongScheduleCardsRemainReadableAndReachableAtNarrowAccessibilityWidth() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-dashboard",
            "--dashboard-narrow",
            "--dashboard-state=upcoming",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ]
        app.launch()

        for (eventID, date) in [
            ("next", "November 14"),
            ("later", "November 21"),
            ("third", "November 28")
        ] {
            let card = app.buttons["dashboard-event-card-fictional-\(eventID)"]
            XCTAssertTrue(card.waitForExistence(timeout: 10), "Missing schedule card \(eventID)")
            for _ in 0..<20 where !card.isHittable { app.swipeUp() }
            XCTAssertTrue(card.isHittable, "Schedule card \(eventID) must remain reachable while scrolling")
            XCTAssertGreaterThan(card.frame.height, 140, "Accessibility schedule cards should expand vertically, not stay tiny squares")
            XCTAssertTrue(card.label.contains("Championship Showcase With a Long Event Name"))
            XCTAssertTrue(card.label.contains("The Visiting Team With a Very Long Name"))
            XCTAssertTrue(card.label.contains(date))
        }
    }

    func testLiveTapsActionsAndRetryRemainUsableAtAccessibilityTextSize() {
        let authorizedApp = launchLiveTaps(state: "authorized")
        let session = reachable("live-taps-session-status", in: authorizedApp)
        XCTAssertTrue(session.label.contains("active"))

        let qrInstructions = reachable("live-taps-qr-instructions", in: authorizedApp)
        XCTAssertTrue(qrInstructions.label.contains("authorized"))
        XCTAssertGreaterThan(qrInstructions.frame.height, 44)
        let scanButton = reachable("live-taps-scan-qr", in: authorizedApp)
        XCTAssertTrue(scanButton.isEnabled)
        XCTAssertGreaterThanOrEqual(scanButton.frame.height, 44)

        let cheer = authorizedApp.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "live-taps-cheer-")
        ).firstMatch
        XCTAssertTrue(cheer.waitForExistence(timeout: 10))
        for _ in 0..<20 where !cheer.isHittable { authorizedApp.swipeUp() }
        XCTAssertTrue(cheer.isHittable)
        XCTAssertTrue(cheer.isEnabled)
        XCTAssertTrue(cheer.label.contains("Amazing Team Effort"))
        XCTAssertGreaterThanOrEqual(cheer.frame.height, 44)
        XCTAssertGreaterThan(cheer.frame.height, 52)
        authorizedApp.terminate()

        let unauthorizedApp = launchLiveTaps(state: "unauthorized")
        let accessStatus = reachable("live-taps-access-status", in: unauthorizedApp)
        XCTAssertTrue(accessStatus.label.contains("PRIVATE FAMILY ACCESS REQUIRED"))
        let instructions = reachable("live-taps-qr-instructions", in: unauthorizedApp)
        XCTAssertTrue(instructions.label.contains("Scan the private family QR"))
        let unauthorizedScan = reachable("live-taps-scan-qr", in: unauthorizedApp)
        XCTAssertTrue(unauthorizedScan.isEnabled)
        let disabledCheer = unauthorizedApp.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "live-taps-cheer-")
        ).firstMatch
        XCTAssertTrue(disabledCheer.waitForExistence(timeout: 10))
        XCTAssertFalse(disabledCheer.isEnabled)
        XCTAssertTrue(disabledCheer.label.contains("Amazing Team Effort"))
        unauthorizedApp.terminate()

        let errorApp = launchLiveTaps(state: "error")
        let retryMessage = reachable("live-taps-message", in: errorApp)
        XCTAssertTrue(retryMessage.label.contains("connection timed out"))
        XCTAssertGreaterThan(retryMessage.frame.height, 44)
        let retry = reachable("live-taps-retry", in: errorApp)
        XCTAssertTrue(retry.isEnabled)
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
    }

    private func launchLiveTaps(state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-live-taps",
            "--live-taps-state=\(state)",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ]
        app.launch()
        return app
    }

    @discardableResult
    private func assertReachable(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier]
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(identifier)")

        for _ in 0..<8 where !element.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable, "\(identifier) is clipped or cannot be reached by scrolling")
        return element
    }

    @discardableResult
    private func reachable(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(identifier)")
        for _ in 0..<20 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable, "\(identifier) must remain reachable at accessibility text sizes")
        return element
    }
}
