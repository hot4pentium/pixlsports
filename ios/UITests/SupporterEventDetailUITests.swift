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

        let water = assertReachable("native-prep-item-water", in: app)
        XCTAssertEqual(water.value as? String, "Not ready")
        water.tap()
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

    func testReadOnlyDetailFixtureDoesNotExposePrivateEditorsWithoutClerk() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail"]
        app.launch()
        let prep = app.buttons["event-card-prep"]
        XCTAssertTrue(prep.waitForExistence(timeout: 10))
        XCTAssertTrue(prep.isEnabled, "Read-only fixture may switch panels, not edit private data")
        prep.tap()
        _ = assertReachable("event-detail-prep-summary", in: app)
        XCTAssertFalse(app.buttons["native-prep-save"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["native-prep-notes"].exists)
        app.buttons["event-card-track-stats"].tap()
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
        XCTAssertTrue(date.label.contains("November 14"))
        let opponent = assertReachable("event-detail-opponent", in: app)
        XCTAssertTrue(opponent.label.contains("Very Long Name"))
        let location = assertReachable("event-detail-location", in: app)
        XCTAssertTrue(location.label.contains("Field Twenty-Seven"))
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
        for _ in 0..<25 where !app.descendants(matching: .any)["event-detail-title"].isHittable {
            swipeDetails(scroll, up: false)
        }
        for _ in 0..<25 where !app.descendants(matching: .any)["event-detail-date"].isHittable {
            swipeDetails(scroll, up: true)
        }
        let date = app.descendants(matching: .any)["event-detail-date"]
        let time = app.descendants(matching: .any)["event-detail-time"]
        XCTAssertTrue(date.isHittable, "The event date must be reachable inside the details viewport")
        XCTAssertTrue(time.exists)
        if accessibility {
            XCTAssertEqual(date.frame.minX, time.frame.minX, accuracy: 2, "Accessibility details must stay single-column")
            XCTAssertGreaterThan(time.frame.minY, date.frame.minY)
        } else {
            XCTAssertEqual(date.frame.minY, time.frame.minY, accuracy: 2, "Default details must keep two columns")
            XCTAssertGreaterThan(time.frame.minX, date.frame.minX)
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
        app.launchArguments = ["--ui-testing-event-detail"]
        app.launch()
        let prep = app.buttons["event-card-prep"]
        XCTAssertTrue(prep.waitForExistence(timeout: 10))
        prep.tap()
        assertReachable("event-detail-prep-summary", in: app)
        app.buttons["event-card-share"].tap()
        XCTAssertTrue(app.navigationBars["Event Details"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["event-detail-prep-summary"].exists)
        app.buttons["event-card-prep"].tap()
        assertReachable("event-detail-prep-summary", in: app)
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
