import XCTest

@MainActor
final class SupporterDashboardUITests: XCTestCase {
    func testDashboardStatesAtNarrowPhoneWidth() {
        for (state, identifier) in [
            ("empty", "dashboard-empty"),
            ("loading", "dashboard-loading"),
            ("unlinked", "dashboard-connection-action"),
            ("error", "dashboard-retry")
        ] {
            let app = launch(state)
            XCTAssertTrue(app.staticTexts["dashboard-title"].waitForExistence(timeout: 10))
            let element = reachable(identifier, in: app)
            if state == "loading" {
                XCTAssertFalse(app.buttons["dashboard-connection-action"].exists)
            } else if state == "empty" {
                XCTAssertTrue(element.label.contains("No upcoming Event Cards"))
            } else if state == "error" {
                element.tap()
                XCTAssertTrue(app.descendants(matching: .any)["dashboard-error"].exists)
            }
            app.terminate()
        }
    }

    func testConnectedDashboardKeepsAthleteContentWithoutConnectionManagement() {
        let app = launch("empty", accessibilityText: true)
        let athlete = reachable("dashboard-athlete", in: app)
        XCTAssertEqual(athlete.label, "Jordan Example With a Long Athlete Name")
        let season = reachable("dashboard-season", in: app)
        XCTAssertTrue(season.label.contains("Autumn Championship Season"))
        XCTAssertFalse(app.buttons["dashboard-connection-action"].exists)
        XCTAssertFalse(app.staticTexts["PIXL account connected"].exists)
        XCTAssertFalse(app.staticTexts["Manage connection"].exists)
        reachable("dashboard-empty", in: app)
    }

    func testFirstTimeConnectionSetupRemainsAvailableWithAccessibilityText() {
        let app = launch("unlinked", accessibilityText: true)
        let connection = reachable("dashboard-connection-action", in: app)
        XCTAssertGreaterThanOrEqual(connection.frame.height, 44)
        connection.tap()
        XCTAssertTrue(app.staticTexts["dashboard-fixture-connection"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        reachable("dashboard-connection-action", in: app)
    }

    func testUpcomingAndLiveCardsKeepNativeNavigation() {
        for state in ["upcoming", "live"] {
            let app = launch(state)
            let card = reachable("dashboard-event-tile-fictional-next", in: app)
            XCTAssertTrue(card.label.contains(state == "live" ? "live" : "upcoming"))
            XCTAssertTrue(card.label.contains("Visiting Team"))
            XCTAssertEqual(card.frame.width, card.frame.height, accuracy: 2)
            card.tap()
            XCTAssertTrue(app.staticTexts["event-detail-title"].waitForExistence(timeout: 5))
            app.terminate()
        }
    }

    func testThreeSquareCardsShareOneRowAndHeroContainsTimeAndPlace() {
        let app = launch("upcoming")
        let hero = reachable("dashboard-message-board-card", in: app)
        XCTAssertTrue(hero.label.contains("6:30"))
        XCTAssertTrue(hero.label.contains("Entrance C"))
        let first = reachable("dashboard-event-tile-fictional-next", in: app)
        let second = reachable("dashboard-event-tile-fictional-later", in: app)
        let third = reachable("dashboard-event-tile-fictional-third", in: app)
        XCTAssertEqual(first.frame.minY, second.frame.minY, accuracy: 2)
        XCTAssertEqual(second.frame.minY, third.frame.minY, accuracy: 2)
        XCTAssertLessThan(first.frame.minX, second.frame.minX)
        XCTAssertLessThan(second.frame.minX, third.frame.minX)
        for tile in [first, second, third] {
            XCTAssertEqual(tile.frame.width, tile.frame.height, accuracy: 2)
        }
    }

    func testEmptyMessageBoardLeadsToNativeEventCardCreation() {
        let app = launch("empty")
        let messageBoard = reachable("dashboard-message-board-card", in: app)
        XCTAssertTrue(messageBoard.label.contains("Tap to create"))
        messageBoard.tap()

        XCTAssertTrue(app.staticTexts["Create an Event Card"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["native-event-create-submit"].exists)
    }

    func testDashboardUsesSeparateHeroUpcomingAndHistorySections() {
        let app = launch("upcoming")
        let hero = app.descendants(matching: .any)["dashboard-hero-section"].firstMatch
        let upcoming = app.descendants(matching: .any)["dashboard-upcoming-section"].firstMatch
        let history = app.descendants(matching: .any)["dashboard-history"].firstMatch
        XCTAssertTrue(hero.waitForExistence(timeout: 10))
        XCTAssertTrue(upcoming.exists)
        XCTAssertTrue(history.exists)
        XCTAssertFalse(hero.descendants(matching: .any)["dashboard-upcoming-section"].exists)
        XCTAssertFalse(upcoming.descendants(matching: .any)["dashboard-history"].exists)
    }

    private func launch(_ state: String, accessibilityText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-dashboard", "--dashboard-narrow", "--dashboard-state=\(state)"]
        if accessibilityText {
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityXXXL"
            ]
        }
        app.launch()
        return app
    }

    @discardableResult
    private func reachable(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing \(identifier)")
        for _ in 0..<20 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable, "\(identifier) must remain reachable in the scroll view")
        return element
    }
}
