import XCTest

@MainActor
final class SupporterDashboardUITests: XCTestCase {
    func testNativeLaunchSplashShowsBrandWithoutAccountRetrievalCopy() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-launch-splash"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["native-launch-wordmark"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["native-launch-status"].exists)
        XCTAssertFalse(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", "retrieving account"))
                .firstMatch.exists
        )
        app.terminate()
    }

    func testNativeLaunchSplashShowsRetryActionAfterStartupFailure() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-launch-splash-error"]
        app.launch()

        XCTAssertTrue(app.staticTexts["We couldn’t get PIXL ready"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["native-launch-retry"].exists)
        app.terminate()
    }

    func testDashboardStatesAtNarrowPhoneWidth() {
        for (state, identifier) in [
            ("empty", "dashboard-empty"),
            ("loading", "dashboard-loading"),
            ("unlinked", "dashboard-connection-action"),
            ("error", "dashboard-retry")
        ] {
            let app = launch(state)
            XCTAssertTrue(app.buttons["dashboard-settings-button"].waitForExistence(timeout: 10))
            XCTAssertFalse(app.staticTexts["Your schedule"].exists)
            XCTAssertFalse(app.staticTexts["Your private schedule, at a glance."].exists)
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

    func testMessageBoardTaskUsesLocalEventTimeAcrossUTCDayBoundary() {
        for (state, expectedTiming, expectedStep) in [
            ("guide-upcoming", "Upcoming", "Prep"),
            ("guide-future-live", "Upcoming", "Prep"),
            ("guide-future-final", "Upcoming", "Prep"),
            ("guide-live", "Live now", "Track Stats"),
            ("guide-postgame", "After the event", "Share")
        ] {
            let app = launch(state)
            let messageBoard = reachable("dashboard-message-board-card", in: app)
            XCTAssertTrue(messageBoard.label.contains(expectedTiming), "\(state): \(messageBoard.label)")
            XCTAssertTrue(messageBoard.label.contains("Championship Showcase"))
            XCTAssertTrue(
                messageBoard.label.contains("November 13"),
                "The Event Card date must use Los Angeles time: \(messageBoard.label)"
            )
            messageBoard.tap()
            XCTAssertTrue(app.staticTexts["event-detail-title"].waitForExistence(timeout: 5))
            assertRecommendedStep(expectedStep, in: app)
            app.terminate()
        }
    }

    func testMessageBoardOpensEventDetailsAtPrepForUpcomingGamesAndPractices() {
        for (state, kind) in [
            ("guide-upcoming", "game prep"),
            ("guide-practice-upcoming", "practice prep")
        ] {
            let app = launch(state)
            let messageBoard = reachable("dashboard-message-board-card", in: app)
            XCTAssertTrue(messageBoard.label.contains("Tap to open \(kind)"), "\(state): \(messageBoard.label)")
            messageBoard.tap()
            XCTAssertTrue(app.staticTexts["event-detail-title"].waitForExistence(timeout: 5))
            assertRecommendedStep("Prep", in: app)
            app.terminate()
        }
    }

    func testMessageBoardAdvancesAfterShareWindowUsingEventTimeZone() {
        let app = launch("guide-after-share-window")
        let messageBoard = reachable("dashboard-message-board-card", in: app)
        XCTAssertTrue(messageBoard.label.contains("November 15"), "\(messageBoard.label)")
        XCTAssertTrue(messageBoard.label.contains("Upcoming"), "\(messageBoard.label)")
        messageBoard.tap()
        XCTAssertTrue(app.staticTexts["event-detail-title"].waitForExistence(timeout: 5))
        assertRecommendedStep("Prep", in: app)
        app.terminate()
    }

    func testBothHeroCardsFitAndOpenTheirNativeScreensAtNormalAndAccessibilitySizes() {
        for accessibilityText in [false, true] {
            let layoutApp = launch("guide-upcoming", accessibilityText: accessibilityText)
            let messageBoard = reachable("dashboard-message-board-card", in: layoutApp)
            let hypeCard = reachable("dashboard-hype-card", in: layoutApp)
            for card in [messageBoard, hypeCard] {
                XCTAssertGreaterThan(card.frame.width, 0)
                XCTAssertGreaterThanOrEqual(card.frame.height, 260)
                XCTAssertGreaterThanOrEqual(card.frame.minX, 0)
                XCTAssertLessThanOrEqual(card.frame.maxX, layoutApp.windows.firstMatch.frame.maxX)
            }
            XCTAssertFalse(messageBoard.frame.intersects(hypeCard.frame), "Hero cards must not overlap.")
            if accessibilityText {
                XCTAssertGreaterThan(hypeCard.frame.minY, messageBoard.frame.minY)
                XCTAssertGreaterThanOrEqual(hypeCard.frame.minY, messageBoard.frame.maxY)
            } else {
                XCTAssertEqual(messageBoard.frame.minY, hypeCard.frame.minY, accuracy: 2)
            }
            layoutApp.terminate()

            let eventApp = launch("guide-upcoming", accessibilityText: accessibilityText)
            reachable("dashboard-message-board-card", in: eventApp).tap()
            XCTAssertTrue(eventApp.staticTexts["event-detail-title"].waitForExistence(timeout: 5))
            assertRecommendedStep("Prep", in: eventApp)
            eventApp.terminate()

            let hypeApp = launch("guide-upcoming", accessibilityText: accessibilityText)
            reachable("dashboard-hype-card", in: hypeApp).tap()
            XCTAssertTrue(hypeApp.staticTexts["HYPE Card"].waitForExistence(timeout: 5))
            hypeApp.terminate()
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
        XCTAssertTrue(first.label.contains("UP NEXT"), "Only the nearest upcoming card is labeled Up Next.")
        XCTAssertFalse(second.label.contains("UP NEXT"), "Later future cards have no Up Next label.")
        XCTAssertFalse(third.label.contains("UP NEXT"), "Later future cards have no Up Next label.")
        XCTAssertEqual(first.frame.minY, second.frame.minY, accuracy: 2)
        XCTAssertEqual(second.frame.minY, third.frame.minY, accuracy: 2)
        XCTAssertLessThan(first.frame.minX, second.frame.minX)
        XCTAssertLessThan(second.frame.minX, third.frame.minX)
        for tile in [first, second, third] {
            XCTAssertEqual(tile.frame.width, tile.frame.height, accuracy: 2)
        }
    }

    func testOnlyNearestUpcomingCardIsLabeledWithAccessibilityText() {
        let app = launch("upcoming", accessibilityText: true)
        XCTAssertTrue(reachable("dashboard-event-card-fictional-next", in: app).label.contains("UP NEXT"))
        for id in ["fictional-later", "fictional-third"] {
            XCTAssertFalse(
                reachable("dashboard-event-card-\(id)", in: app).label.contains("UP NEXT"),
                "Later future cards must remain unlabeled with large text too."
            )
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

    func testEventCardFormControlsRemainReachableAtDefaultAndAccessibilityTextSizes() {
        for accessibilityText in [false, true] {
            let app = launch("empty", accessibilityText: accessibilityText)
            reachable("dashboard-message-board-card", in: app).tap()

            XCTAssertTrue(app.staticTexts["Create an Event Card"].waitForExistence(timeout: 5))
            for (identifier, expectedLabel) in [
                ("native-event-opponent", "Opponent"),
                ("native-event-date", "Date"),
                ("native-event-start-time", "Start time"),
                ("native-event-time-zone", "Event time zone"),
                ("native-event-location", "Location")
            ] {
                let control = reachable(identifier, in: app)
                XCTAssertTrue(
                    control.label.localizedCaseInsensitiveContains(expectedLabel),
                    "\(identifier) should expose its complete label to VoiceOver: \(control.label)"
                )
                XCTAssertGreaterThan(control.frame.height, 0)
            }

            let save = reachable("native-event-create-submit", in: app)
            XCTAssertTrue(save.label.contains("Create Event Card"))
            retainScreenshot(
                in: app,
                name: "Create Event Card — \(accessibilityText ? "AX XXXL" : "default")"
            )
            app.terminate()
        }
    }

    func testDashboardKeepsEventCardsAndHidesPastHistoryAndUpNextHeading() {
        let app = launch("upcoming")
        let hero = app.descendants(matching: .any)["dashboard-hero-section"].firstMatch
        let upcoming = app.descendants(matching: .any)["dashboard-upcoming-section"].firstMatch
        let history = app.descendants(matching: .any)["dashboard-history"].firstMatch
        XCTAssertTrue(hero.waitForExistence(timeout: 10))
        XCTAssertTrue(upcoming.exists)
        XCTAssertFalse(history.exists)
        XCTAssertTrue(app.staticTexts["Event Cards"].exists)
        XCTAssertFalse(app.staticTexts["Up next"].exists)
        XCTAssertFalse(app.staticTexts["Past Event Cards"].exists)
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

    private func retainScreenshot(in app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func assertRecommendedStep(_ title: String, in app: XCUIApplication) {
        let recommendation = app.staticTexts["event-detail-recommended-step"]
        XCTAssertTrue(recommendation.waitForExistence(timeout: 5))
        XCTAssertEqual(recommendation.label, "Next: \(title)")

        let buttonIdentifier: String
        switch title {
        case "Prep": buttonIdentifier = "event-card-prep"
        case "Track Stats": buttonIdentifier = "event-card-track-stats"
        default: buttonIdentifier = "event-card-share"
        }
        XCTAssertEqual(
            app.buttons[buttonIdentifier].value as? String,
            "Recommended next step",
            "\(title) should be the highlighted recommendation."
        )
        let panel = reachable("event-detail-tool-panel", in: app)
        XCTAssertTrue(panel.staticTexts[title].exists, "The Content panel should open \(title).")
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
