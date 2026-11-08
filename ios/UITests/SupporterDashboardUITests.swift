import XCTest

@MainActor
final class SupporterDashboardUITests: XCTestCase {
    func testStartupDiagnosticRendersAfterSDKConfiguration() {
        let app = XCUIApplication()
        app.launchArguments = ["--diagnose-startup"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["startup-check-configured"]
            .waitForExistence(timeout: 10))
        app.buttons["startup-check-read-state"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["startup-check-state"]
            .waitForExistence(timeout: 10))
        app.buttons["startup-check-app-sign-in"].tap()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 15),
                      "The themed SDK sign-in form should render.")
        app.buttons["startup-check-read-state"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["startup-check-state"]
            .waitForExistence(timeout: 5), "The diagnostic must remain responsive.")
        app.terminate()
    }

    func testSharedHypeCardRecipientIsReadOnlyAndHidesUnavailableSections() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-shared-hype-card"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Shared HYPE Card"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["native-hype-card-side-front"].exists)
        let videos = app.buttons["native-hype-card-side-videos"]
        XCTAssertTrue(videos.exists)
        XCTAssertFalse(app.buttons["native-hype-card-side-stats"].exists)
        XCTAssertFalse(app.buttons["native-hype-card-side-events"].exists)
        XCTAssertFalse(app.staticTexts["Owner controls"].exists)
        XCTAssertFalse(app.buttons["native-hype-card-toggle-public"].exists)

        videos.tap()
        XCTAssertTrue(app.buttons["native-public-hype-card-done"].exists)
        app.terminate()
    }

    /// Runs the real Clerk/bootstrap path, not a forced splash/dashboard fixture.
    /// Requires the test target's installed Clerk configuration. Does not sign
    /// out, delete the account, or modify the device's saved athlete data.
    func testConfiguredColdLaunchReachesVisibleAndActionableContent() {
        let app = XCUIApplication()
        app.launchArguments = []
        app.launch()

        let splash = app.descendants(matching: .any)["native-launch-wordmark"]
        let signIn = app.descendants(matching: .any)["native-sign-in-screen"]
        let dashboard = app.buttons["dashboard-settings-button"]
        let retry = app.buttons["native-launch-retry"]
        let visible = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                splash.exists || signIn.exists || dashboard.exists || retry.exists
            },
            object: nil
        )
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 10), .completed,
                       "Normal startup must paint content instead of staying black.")

        let actionable = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                signIn.exists || dashboard.exists || retry.exists
            },
            object: nil
        )
        XCTAssertEqual(XCTWaiter.wait(for: [actionable], timeout: 30), .completed,
                       "Startup must reach sign-in, the dashboard, or an explicit retry.")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
    }

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

    func testFanBaseOfflineRetryShowsTheFetchedCountAfterReconnect() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-fan-base-refresh", "--dashboard-narrow"]
        app.launch()
        reachable("dashboard-fan-base-entry", in: app).tap()

        let unavailableMessage = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "no current count is shown")
        ).firstMatch
        XCTAssertTrue(unavailableMessage.waitForExistence(timeout: 10))
        XCTAssertTrue(reachable("dashboard-fan-base-status", in: app).exists)
        XCTAssertTrue(reachable("dashboard-fan-base-retry", in: app).exists)
        XCTAssertFalse(app.staticTexts["3 FOLLOWS"].exists)

        app.navigationBars.buttons["Done"].firstMatch.tap()
        reachable("fan-base-fixture-reconnect", in: app).tap()
        reachable("dashboard-fan-base-entry", in: app).tap()
        reachable("dashboard-fan-base-retry", in: app).tap()

        XCTAssertTrue(app.staticTexts["3 FOLLOWS"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["dashboard-fan-base-status"].exists)
        XCTAssertTrue(app.staticTexts["Casey"].exists)
        app.terminate()
    }

    func testFanBaseRefreshShowsRemoteFollowAndUnfollowChanges() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-fan-base-refresh",
            "--dashboard-narrow",
            "--fan-base-start-loaded"
        ]
        app.launch()

        reachable("dashboard-fan-base-entry", in: app).tap()
        XCTAssertTrue(app.staticTexts["3 FOLLOWS"].waitForExistence(timeout: 10))
        app.navigationBars.buttons["Done"].firstMatch.tap()
        reachable("fan-base-fixture-remote-follow", in: app).tap()
        reachable("dashboard-fan-base-entry", in: app).tap()
        XCTAssertTrue(app.staticTexts["3 FOLLOWS"].exists,
                      "A remote change must not alter the displayed summary before refresh.")
        app.navigationBars.buttons["Done"].firstMatch.tap()
        reachable("fan-base-fixture-refresh", in: app).tap()
        reachable("dashboard-fan-base-entry", in: app).tap()
        XCTAssertTrue(app.staticTexts["4 FOLLOWS"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["3 FOLLOWS"].exists)

        app.navigationBars.buttons["Done"].firstMatch.tap()
        reachable("fan-base-fixture-remote-follow", in: app).tap()
        reachable("dashboard-fan-base-entry", in: app).tap()
        XCTAssertTrue(app.staticTexts["4 FOLLOWS"].exists,
                      "A remote unfollow must not alter the displayed summary before refresh.")
        app.navigationBars.buttons["Done"].firstMatch.tap()
        reachable("fan-base-fixture-refresh", in: app).tap()
        reachable("dashboard-fan-base-entry", in: app).tap()
        XCTAssertTrue(app.staticTexts["3 FOLLOWS"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["4 FOLLOWS"].exists)
        app.terminate()
    }

    func testFailedFanBaseRefreshDoesNotKeepThePreviousCountCurrent() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-fan-base-refresh",
            "--dashboard-narrow",
            "--fan-base-start-loaded"
        ]
        app.launch()

        XCTAssertTrue(reachable("dashboard-fan-base-entry", in: app).exists)
        XCTAssertFalse(app.descendants(matching: .any)["dashboard-fan-base"].exists)
        reachable("dashboard-fan-base-entry", in: app).tap()
        XCTAssertTrue(app.staticTexts["3 FOLLOWS"].exists)
        app.navigationBars.buttons["Done"].firstMatch.tap()
        reachable("fan-base-fixture-failed-refresh", in: app).tap()
        reachable("fan-base-fixture-refresh", in: app).tap()
        reachable("dashboard-fan-base-entry", in: app).tap()

        let unavailableMessage = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "no current count is shown")
        ).firstMatch
        XCTAssertTrue(unavailableMessage.waitForExistence(timeout: 10))
        XCTAssertTrue(reachable("dashboard-fan-base-status", in: app).exists)
        XCTAssertTrue(reachable("dashboard-fan-base-retry", in: app).exists)
        XCTAssertFalse(app.staticTexts["3 FOLLOWS"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["dashboard-fan-base"].exists)
        app.terminate()
    }

    func testCompactFanBaseEntrySitsBelowHypeCardAndOpensAllDetails() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-fan-base-refresh",
            "--dashboard-narrow",
            "--fan-base-start-loaded"
        ]
        app.launch()

        let hypeCard = reachable("dashboard-hype-card", in: app)
        let entry = reachable("dashboard-fan-base-entry", in: app)
        XCTAssertEqual(entry.frame.midX, hypeCard.frame.midX, accuracy: 2)
        XCTAssertGreaterThanOrEqual(entry.frame.minY, hypeCard.frame.maxY)
        XCTAssertLessThanOrEqual(entry.frame.width, 161)
        XCTAssertGreaterThanOrEqual(entry.frame.height, 44)
        XCTAssertLessThanOrEqual(entry.frame.height, 60)
        XCTAssertEqual(entry.label, "Fan Base")
        XCTAssertFalse(app.staticTexts["3 FOLLOWS"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["dashboard-fan-base"].exists)
        XCTAssertFalse(app.staticTexts["Casey"].exists)

        entry.tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-fan-base-page"].waitForExistence(timeout: 5))
        XCTAssertTrue(reachable("dashboard-fan-base", in: app).exists)
        XCTAssertTrue(app.staticTexts["Casey"].exists)
        XCTAssertTrue(app.staticTexts["Follows are from devices; names are self-entered."].exists)
        app.navigationBars.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(reachable("dashboard-fan-base-entry", in: app).exists)
        app.terminate()
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

    func testMessageBoardDetailsAndFooterRemainReadableAcrossContentAndTextSizes() {
        for state in ["upcoming", "guide-upcoming"] {
            for accessibilityText in [false, true] {
                let app = launch(state, accessibilityText: accessibilityText)
                let board = reachable("dashboard-message-board-card", in: app)
                let hype = reachable("dashboard-hype-card", in: app)
                XCTAssertGreaterThanOrEqual(board.frame.height, 260)
                XCTAssertFalse(board.frame.intersects(hype.frame))
                XCTAssertGreaterThanOrEqual(board.frame.minX, 0)
                XCTAssertLessThanOrEqual(board.frame.maxX, app.windows.firstMatch.frame.maxX)
                if state == "guide-upcoming" {
                    XCTAssertTrue(board.label.contains("Entrance C"),
                                  "The complete venue remains available to VoiceOver.")
                }
                // Retain the real SwiftUI rendering for review of the centered
                // details, protected footer gap, and large-text line wrapping.
                retainScreenshot(in: app, name: "Message-Board-\(state)-\(accessibilityText ? "Large" : "Standard")")
                app.terminate()
            }
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

    func testLongPressEventCardOpensPrefilledEditorInBothDashboardLayouts() {
        for accessibilityText in [false, true] {
            let app = launch("upcoming", accessibilityText: accessibilityText)
            let cardID = accessibilityText
                ? "dashboard-event-card-fictional-next"
                : "dashboard-event-tile-fictional-next"
            let card = reachable(cardID, in: app)
            card.press(forDuration: 1.1)

            let edit = app.descendants(matching: .any)
                .matching(identifier: "dashboard-event-edit-action-fictional-next").firstMatch
            XCTAssertTrue(edit.waitForExistence(timeout: 5), "Long press must offer Edit in both layouts.")
            edit.tap()

            XCTAssertTrue(app.staticTexts["Edit Event Card"].waitForExistence(timeout: 5))
            let opponent = app.textFields["native-event-opponent"]
            XCTAssertTrue(opponent.exists)
            XCTAssertEqual(opponent.value as? String, "The Visiting Team With a Very Long Name")
            XCTAssertTrue(app.buttons["native-event-create-submit"].exists)
            app.terminate()
        }
    }

    func testLongPressDeleteRequiresConfirmationAndKeepsTheDateHistory() {
        for accessibilityText in [false, true] {
            let app = launch("upcoming", accessibilityText: accessibilityText)
            let cardID = accessibilityText
                ? "dashboard-event-card-fictional-next"
                : "dashboard-event-tile-fictional-next"
            let card = reachable(cardID, in: app)
            card.press(forDuration: 1.1)

            let delete = app.descendants(matching: .any)
                .matching(identifier: "dashboard-event-delete-action-fictional-next").firstMatch
            XCTAssertTrue(delete.waitForExistence(timeout: 5), "Long press must offer Delete in both layouts.")
            delete.tap()
            XCTAssertTrue(app.staticTexts["Delete this Event Card?"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts.containing(
                NSPredicate(format: "label CONTAINS %@", "Stats and game history for this date stay saved")
            ).firstMatch.exists)
            app.buttons["dashboard-event-delete-confirm"].tap()

            XCTAssertTrue(app.alerts.staticTexts["Event Card deleted"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.descendants(matching: .any)[cardID].exists)
            XCTAssertTrue(app.descendants(matching: .any)["dashboard-event-tile-fictional-later"].exists)
            app.terminate()
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

    func testSeasonRecordIsReadableAtDefaultAndAccessibilityTextSizes() {
        for accessibilityText in [false, true] {
            let app = launch("upcoming", accessibilityText: accessibilityText)
            let card = reachable("dashboard-season-record", in: app)
            XCTAssertGreaterThan(card.frame.width, 0)
            XCTAssertLessThanOrEqual(card.frame.maxX, app.frame.maxX)
            for label in ["2 wins", "1 loss", "1 tie"] {
                XCTAssertTrue(
                    card.descendants(matching: .any)
                        .matching(NSPredicate(format: "label == %@", label))
                        .firstMatch.exists,
                    "The record must expose readable \(label)."
                )
            }
            app.terminate()
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

    func testOfflineEventCardRetryAfterInterruptedResponseCreatesExactlyOneCard() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-event-card-create-retry", "--dashboard-narrow"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Create an Event Card"].waitForExistence(timeout: 5))
        XCTAssertEqual(
            app.staticTexts["native-event-create-fixture-connection"].label,
            "PIXL connection: Offline"
        )
        let opponent = app.textFields["native-event-opponent"]
        XCTAssertTrue(opponent.waitForExistence(timeout: 5))
        opponent.tap()
        opponent.typeText("Bears\n")
        let location = app.textFields["native-event-location"]
        location.tap()
        location.typeText("North Field")

        app.buttons["native-event-create-submit"].tap()
        let localStatus = app.staticTexts["native-event-create-local-status"]
        XCTAssertTrue(localStatus.waitForExistence(timeout: 5))
        XCTAssertTrue(localStatus.label.contains("Saved on this iPhone"))
        XCTAssertTrue(localStatus.label.contains("Waiting to sync"))
        XCTAssertTrue(app.buttons["native-event-create-retry"].exists)
        XCTAssertEqual(app.staticTexts["native-event-create-fixture-saved-count"].label, "Pending Event Cards: 1")
        XCTAssertEqual(app.staticTexts["native-event-create-fixture-server-count"].label, "Server Event Cards: 0")

        app.buttons["native-event-create-fixture-reconnect"].tap()
        XCTAssertEqual(
            app.staticTexts["native-event-create-fixture-connection"].label,
            "PIXL connection: Reconnected"
        )
        app.buttons["native-event-create-retry"].tap()

        let interruptedResponse = app.staticTexts["native-event-create-local-status"]
        XCTAssertTrue(interruptedResponse.waitForExistence(timeout: 5))
        XCTAssertTrue(interruptedResponse.label.contains("could not confirm the save"))
        XCTAssertTrue(app.buttons["native-event-create-retry"].exists)
        XCTAssertEqual(app.staticTexts["native-event-create-fixture-saved-count"].label, "Pending Event Cards: 1")
        XCTAssertEqual(app.staticTexts["native-event-create-fixture-server-count"].label, "Server Event Cards: 1")
        XCTAssertTrue(
            app.staticTexts["native-event-create-fixture-saved-details"].label.contains("Bears at North Field")
        )

        app.buttons["native-event-create-retry"].tap()
        XCTAssertTrue(app.staticTexts["native-event-create-fixture-confirmed-count"]
            .waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["native-event-create-fixture-saved-count"].label, "Pending Event Cards: 0")
        XCTAssertEqual(app.staticTexts["native-event-create-fixture-server-count"].label, "Server Event Cards: 1")
        XCTAssertEqual(app.staticTexts["native-event-create-fixture-confirmed-count"].label, "Confirmed Event Cards: 1")
        XCTAssertFalse(app.staticTexts["native-event-create-error"].exists)
        XCTAssertFalse(app.buttons["native-event-create-retry"].exists)
        app.terminate()
    }

    func testTwoDeviceEventCardEditConflictPreservesBothChoicesWithoutDuplicateCards() {
        for choice in ["keep-local", "use-server"] {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-testing-event-card-conflict"]
            app.launch()

            XCTAssertTrue(app.staticTexts["Edit Event Card"].waitForExistence(timeout: 5))
            XCTAssertEqual(
                app.staticTexts["native-event-card-conflict-fixture-connection"].label,
                "PIXL connection: Offline"
            )
            let location = app.textFields["native-event-location"]
            XCTAssertTrue(location.waitForExistence(timeout: 5))
            location.tap()
            location.typeText("Home Field\n")
            reachable("native-event-create-submit", in: app).tap()

            XCTAssertTrue(app.staticTexts["native-event-create-local-status"].waitForExistence(timeout: 5))
            XCTAssertEqual(
                app.staticTexts["native-event-card-conflict-fixture-pending-count"].label,
                "Pending Event Cards: 1"
            )
            XCTAssertEqual(
                app.staticTexts["native-event-card-conflict-fixture-server-count"].label,
                "Server Event Cards: 1"
            )
            XCTAssertTrue(app.staticTexts["native-event-card-conflict-fixture-server-details"].label
                .contains("Tigers"))

            reachable("native-event-card-conflict-fixture-remote-edit", in: app).tap()
            XCTAssertTrue(app.staticTexts["native-event-card-conflict-fixture-server-details"].label
                .contains("Cougars"))
            XCTAssertTrue(app.staticTexts["native-event-card-conflict-fixture-server-details"].label
                .contains("Away Field"))
            XCTAssertEqual(
                app.staticTexts["native-event-card-conflict-fixture-pending-count"].label,
                "Pending Event Cards: 1",
                "The offline iPhone edit must remain saved after the other device changes the card."
            )

            reachable("native-event-card-conflict-fixture-reconnect", in: app).tap()
            XCTAssertEqual(
                app.staticTexts["native-event-card-conflict-fixture-connection"].label,
                "PIXL connection: Reconnected"
            )
            reachable("native-event-create-retry", in: app).tap()

            let conflictPanel = app.descendants(matching: .any)["native-event-card-conflict-panel"]
            XCTAssertTrue(conflictPanel.waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts["Your iPhone edits"].exists)
            XCTAssertTrue(app.staticTexts["Current server version"].exists)
            let localVersion = app.staticTexts["native-event-card-conflict-local-version"]
            let serverVersion = app.staticTexts["native-event-card-conflict-server-version"]
            XCTAssertTrue(localVersion.label.contains("Tigers"))
            XCTAssertTrue(localVersion.label.contains("Home Field"))
            XCTAssertTrue(serverVersion.label.contains("Cougars"))
            XCTAssertTrue(serverVersion.label.contains("Away Field"))
            XCTAssertTrue(app.buttons["native-event-card-conflict-keep-local"].exists)
            XCTAssertTrue(app.buttons["native-event-card-conflict-use-server"].exists)

            if choice == "keep-local" {
                reachable("native-event-card-conflict-keep-local", in: app).tap()
                XCTAssertTrue(app.staticTexts["native-event-create-local-status"].label
                    .contains("Your iPhone edits are now on the server"))
                XCTAssertTrue(app.staticTexts["native-event-card-conflict-fixture-server-details"].label
                    .contains("Home Field"))
                XCTAssertTrue(app.staticTexts["native-event-card-conflict-fixture-server-details"].label
                    .contains("Tigers"))
            } else {
                reachable("native-event-card-conflict-use-server", in: app).tap()
                XCTAssertTrue(app.staticTexts["native-event-create-local-status"].label
                    .contains("The server version is kept"))
                XCTAssertTrue(app.staticTexts["native-event-card-conflict-fixture-server-details"].label
                    .contains("Away Field"))
                XCTAssertTrue(app.staticTexts["native-event-card-conflict-fixture-server-details"].label
                    .contains("Cougars"))
            }

            XCTAssertEqual(
                app.staticTexts["native-event-card-conflict-fixture-pending-count"].label,
                "Pending Event Cards: 0"
            )
            XCTAssertEqual(
                app.staticTexts["native-event-card-conflict-fixture-server-count"].label,
                "Server Event Cards: 1",
                "Resolving a conflict must update or retain the same Event Card, never create a duplicate."
            )
            XCTAssertFalse(conflictPanel.exists)
            app.terminate()
        }
    }

    func testEventCardFormControlsRemainReachableAtDefaultAndAccessibilityTextSizes() {
        for accessibilityText in [false, true] {
            let app = launch("empty", accessibilityText: accessibilityText)
            reachable("dashboard-message-board-card", in: app).tap()

            XCTAssertTrue(app.staticTexts["Create an Event Card"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts[
                "Event Cards sync to your PIXL account. If PIXL can’t be reached, this iPhone keeps a private draft until it can sync."
            ].exists)
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

    func testDashboardKeepsPastEventCardsAlongsideSeasonMarkers() {
        let app = launch("upcoming")
        let hero = app.descendants(matching: .any)["dashboard-hero-section"].firstMatch
        let upcoming = app.descendants(matching: .any)["dashboard-upcoming-section"].firstMatch
        XCTAssertTrue(hero.waitForExistence(timeout: 10))
        XCTAssertTrue(upcoming.exists)
        XCTAssertTrue(app.staticTexts["Event Cards"].exists)
        XCTAssertFalse(app.staticTexts["Up next"].exists)
        XCTAssertFalse(hero.descendants(matching: .any)["dashboard-upcoming-section"].exists)

        let passedCard = reachable("dashboard-event-tile-fictional-past", in: app)
        XCTAssertTrue(passedCard.label.contains("COMPLETE"), "A passed Event Card remains available as a season marker.")
        XCTAssertTrue(reachable("dashboard-event-tile-fictional-next", in: app).label.contains("UP NEXT"),
                      "The nearest future Event Card stays labeled Up Next.")
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
