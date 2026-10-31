import XCTest

@MainActor
final class SupporterEventDetailUITests: XCTestCase {
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
        assertReachable("event-detail-live-taps", in: app)
    }

    func testEventStepButtonsStayAtTheBottomWhenDetailsScroll() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-detail"]
        app.launch()
        let prep = app.buttons["event-card-prep"].firstMatch
        XCTAssertTrue(prep.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["event-card-track-stats"].exists)
        XCTAssertTrue(app.buttons["event-card-share"].exists)
        let initialY = prep.frame.minY
        XCTAssertGreaterThanOrEqual(prep.frame.height, 44)
        app.swipeUp()
        XCTAssertEqual(prep.frame.minY, initialY, accuracy: 2)
        XCTAssertLessThanOrEqual(prep.frame.maxY, app.frame.maxY)
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
