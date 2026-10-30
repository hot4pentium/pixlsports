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
        let date = assertReachable("event-detail-date", in: app)
        XCTAssertTrue(date.label.contains("November 14"))
        let opponent = assertReachable("event-detail-opponent", in: app)
        XCTAssertTrue(opponent.label.contains("Very Long Name"))
        let location = assertReachable("event-detail-location", in: app)
        XCTAssertTrue(location.label.contains("Field Twenty-Seven"))
        let status = assertReachable("event-detail-status", in: app)
        XCTAssertTrue(status.label.contains("Live"))
        assertReachable("event-detail-live-taps", in: app)
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
}
