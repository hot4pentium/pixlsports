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
    func testSignedInQuickPrepCheckoffPersistsAfterSavingAndReopening() throws {
        try checkSignedInPrepPersistence(dropFirstResponse: false)
    }

    func testSignedInQuickPrepLostResponseRetriesSameMutationAfterRelaunch() throws {
        try checkSignedInPrepPersistence(dropFirstResponse: true)
    }

    private func checkSignedInPrepPersistence(dropFirstResponse: Bool) throws {
        let environment = ProcessInfo.processInfo.environment
        guard let eventID = environment["PIXL_PREP_TEST_EVENT_ID"], !eventID.isEmpty,
              let itemID = environment["PIXL_PREP_TEST_ITEM_ID"], !itemID.isEmpty else {
            throw XCTSkip("Set PIXL_PREP_TEST_EVENT_ID and PIXL_PREP_TEST_ITEM_ID for a dedicated development Event Card and one of its first four Prep items. Sign in and link its owner on this simulator first.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-signed-in-prep"]
        if dropFirstResponse { app.launchArguments.append("--prep-save-lost-response-once") }
        app.launch()
        defer { app.terminate() }

        openSignedInPrep(eventID: eventID, in: app)
        let itemIdentifier = "native-prep-item-\(itemID)"
        let item = assertReachable(itemIdentifier, in: app)
        let originalValue = item.value as? String
        XCTAssertEqual(originalValue, "Not ready", "Prepare an unchecked task so this test checks it off.")
        let changedValue = "Ready"
        let originalProgress = app.staticTexts["native-prep-quick-progress"].label
        XCTAssertFalse(assertReachable("native-prep-save", in: app).isEnabled,
                       "Start with saved Prep and no unresolved pending command.")
        reachableFromAbove(itemIdentifier, in: app).tap()
        XCTAssertEqual(item.value as? String, changedValue)
        let changedProgress = app.staticTexts["native-prep-quick-progress"].label
        XCTAssertNotEqual(changedProgress, originalProgress)
        let save = assertReachable("native-prep-save", in: app)
        XCTAssertTrue(save.isEnabled)
        save.tap()

        if dropFirstResponse {
            let error = app.descendants(matching: .any)["native-tool-save-error"].firstMatch
            XCTAssertTrue(error.waitForExistence(timeout: 10))
            XCTAssertTrue(error.label.contains("Test server committed Prep"))
            XCTAssertTrue(error.label.contains("response dropped before acknowledgement"))
            XCTAssertTrue(error.label.contains("kept on this iPhone"))
            XCTAssertTrue(app.staticTexts["Unsaved changes"].exists)
            XCTAssertFalse(save.isEnabled, "Use the retained-command retry, not a new save.")
            XCTAssertFalse(reachableFromAbove(itemIdentifier, in: app).isEnabled)
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
            XCTAssertTrue(app.descendants(matching: .any)["native-tool-save-error"].exists)
            let restoredRetry = assertReachable("native-tool-save-retry", in: app)
            XCTAssertEqual(restoredRetry.value as? String, mutationID,
                           "Relaunch must restore the same account/event-scoped mutation.")
            restoredRetry.tap()
        }

        waitForPrepSaved(in: app)
        reopenSignedInPrep(eventID: eventID, in: app)
        XCTAssertEqual(assertReachable(itemIdentifier, in: app).value as? String, changedValue,
                       "Fresh Event Details must load the server-confirmed checkoff.")
        XCTAssertEqual(app.staticTexts["native-prep-quick-progress"].label, changedProgress)
        XCTAssertFalse(assertReachable("native-prep-save", in: app).isEnabled)
        XCTAssertFalse(app.descendants(matching: .any)["native-tool-save-error"].exists)

        // Restore the dedicated test item and verify that write too. Never
        // delete a card, clear all defaults, or modify a user's other tasks.
        reachableFromAbove(itemIdentifier, in: app).tap()
        assertReachable("native-prep-save", in: app).tap()
        waitForPrepSaved(in: app)
        reopenSignedInPrep(eventID: eventID, in: app)
        XCTAssertEqual(assertReachable(itemIdentifier, in: app).value as? String, originalValue)
        XCTAssertEqual(app.staticTexts["native-prep-quick-progress"].label, originalProgress)
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
        XCTAssertTrue(app.navigationBars["Event Details"].waitForExistence(timeout: 15))
        app.buttons["event-card-prep"].tap()
        _ = assertReachable("native-prep-quick-progress", in: app)
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

    private func reopenSignedInPrep(eventID: String, in app: XCUIApplication) {
        app.navigationBars["Event Details"].buttons.firstMatch.tap()
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
        XCTAssertTrue(app.navigationBars["Event Details"].waitForExistence(timeout: 10))

        let quickWater = assertReachable("native-prep-item-water", in: app)
        XCTAssertEqual(quickWater.value as? String, "Not ready")
        quickWater.tap()
        XCTAssertEqual(quickWater.value as? String, "Ready")
        XCTAssertEqual(app.staticTexts["native-prep-quick-progress"].label, "1 of 2 ready")
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

        app.navigationBars["Event Details"].buttons["Back"].tap()
        let discard = app.buttons["Leave without saving"]
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Event Details"].exists, "Requesting Back must not pop the dirty editor")
        app.buttons["Cancel"].tap()
        XCTAssertFalse(discard.exists)
        assertDraftRemains(in: app, notes: draftNotes, addedTask: addedTask)

        app.navigationBars["Event Details"].buttons["Back"].tap()
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        discard.tap()
        XCTAssertTrue(openEvent.waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Event Details"].exists)

        // Discarding is not an implicit save. Reopening starts from the same
        // saved fixture, rather than the abandoned local draft.
        openEvent.tap()
        XCTAssertTrue(app.navigationBars["Event Details"].waitForExistence(timeout: 5))
        XCTAssertEqual(recommendation.label, "Next: Share")
        app.buttons["event-card-prep"].tap()
        _ = assertReachable("native-prep-item-water", in: app)
        XCTAssertEqual(water.value as? String, "Not ready")
        XCTAssertFalse(addedTask.exists)
        let savedNotes = assertReachable("native-prep-notes", in: app)
        XCTAssertEqual(savedNotes.value as? String, "Saved fixture note")
        XCTAssertFalse(assertReachable("native-prep-save", in: app).isEnabled)
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
            XCTAssertEqual(app.staticTexts["native-prep-quick-progress"].label, "\(index + 1) of 5 ready")
        }
        XCTAssertFalse(app.buttons["native-prep-item-snack"].exists,
                       "Content should show only the first four tasks")
        let manage = revealPrepControl("native-prep-manage-full", in: app)
        XCTAssertEqual(manage.label, "Manage full Prep")
        XCTAssertLessThanOrEqual(app.buttons["native-prep-item-arrival"].frame.maxY, manage.frame.minY)
        try auditPrepControl(manage, in: app)
        retainPrepScreenshot(in: app, name: "Manage full Prep — \(accessibility ? "AX XXXL" : "default")")
        manage.tap()

        // Both presentations edit the same in-memory draft, never a fixture save.
        for task in tasks {
            XCTAssertEqual(app.buttons["native-prep-item-\(task.0)"].value as? String, "Ready")
        }
        let fifth = revealPrepControl("native-prep-item-snack", in: app)
        XCTAssertEqual(fifth.value as? String, "Not ready")
        fifth.tap()
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
        _ = revealPrepControl("native-prep-item-water", in: app)
        XCTAssertEqual(app.staticTexts["native-prep-quick-progress"].label, "5 of 5 ready")
        for task in tasks {
            XCTAssertEqual(app.buttons["native-prep-item-\(task.0)"].value as? String, "Ready")
        }
        XCTAssertFalse(app.buttons["native-prep-item-snack"].exists)
        XCTAssertTrue(revealPrepControl("native-prep-save", in: app).isEnabled)
        revealPrepControl("native-prep-manage-full", in: app).tap()
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
        assertSelectedContent("Prep", in: app)
        XCTAssertFalse(app.buttons["native-prep-save"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["native-prep-notes"].exists)
        app.buttons["event-card-track-stats"].tap()
        assertSelectedContent("Track Stats", in: app)
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
        XCTAssertTrue(app.navigationBars["Event Details"].exists, "Recommendation/resume must not pop Event Details")
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
            XCTAssertTrue(app.navigationBars["Event Details"].exists)
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
        XCTAssertEqual(date.frame.minX, time.frame.minX, accuracy: 2, "Schedule metadata should share a compact column")
        XCTAssertGreaterThan(time.frame.minY, date.frame.minY)
        XCTAssertGreaterThan(location.frame.minY, time.frame.minY)
        if accessibility {
            XCTAssertEqual(date.frame.minX, title.frame.minX, accuracy: 2, "Accessibility details should stack beneath the event identity")
        } else {
            XCTAssertGreaterThan(date.frame.minX, title.frame.minX, "Default layout should place schedule details beside the event identity")
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
        assertSelectedContent("Prep", in: app)
        app.buttons["event-card-share"].tap()
        assertSelectedContent("Share", in: app)
        XCTAssertTrue(app.navigationBars["Event Details"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["event-detail-prep-summary"].exists)
        app.buttons["event-card-track-stats"].tap()
        assertSelectedContent("Track Stats", in: app)
        app.buttons["event-card-prep"].tap()
        assertSelectedContent("Prep", in: app)
        assertReachable("event-detail-prep-summary", in: app)
        XCTAssertEqual(refreshCount(loadCount), initialDetailLoads,
                       "Changing Event Details tools must not reload the schedule.")
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
        XCTAssertTrue(app.navigationBars["Event Details"].waitForExistence(timeout: 10))
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
            XCTAssertTrue(app.navigationBars["Event Details"].waitForExistence(timeout: 10))
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

    private func assertSelectedContent(_ title: String, in app: XCUIApplication) {
        let panel = app.descendants(matching: .any)["event-detail-tool-panel"].firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        XCTAssertTrue(panel.staticTexts[title].exists, "The Event Details Content section should show \(title).")
        XCTAssertEqual(panel.staticTexts["event-tool-title"].label, title)
        XCTAssertFalse(panel.staticTexts["event-tool-summary"].label.isEmpty)
        XCTAssertFalse(panel.staticTexts["event-tool-event-context"].label.isEmpty,
                       "The selected tool should retain visible context for its Event Card.")
        let expectedContext: String
        switch title {
        case "Prep": expectedContext = "BEFORE THE EVENT"
        case "Track Stats": expectedContext = "GAME SCOREKEEPING"
        case "Share": expectedContext = "SHARE THIS EVENT"
        default: XCTFail("Unexpected Event Details tool \(title)"); return
        }
        XCTAssertEqual(panel.staticTexts["event-tool-context"].label, expectedContext)
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
