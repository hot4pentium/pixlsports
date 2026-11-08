import XCTest

/// Runs against a dedicated, already signed-in development owner on an Apple
/// simulator or iPhone. Each visibility mode is run separately because the
/// owner preview endpoint intentionally returns either a public or private card.
@MainActor
final class NativeHypeCardOfflineUITests: XCTestCase {
    private func requireVisibility(_ expected: String) throws {
        guard ProcessInfo.processInfo.environment["PIXL_HYPE_CARD_OFFLINE_VISIBILITY"] == expected else {
            throw XCTSkip(
                "Set PIXL_HYPE_CARD_OFFLINE_VISIBILITY=\(expected) and sign in to a dedicated "
                    + "\(expected) HYPE Card owner before running this test."
            )
        }
    }

    private func openOwnerCard(in app: XCUIApplication, visibility: String) {
        let dashboardCard = app.buttons["dashboard-hype-card"]
        XCTAssertTrue(
            dashboardCard.waitForExistence(timeout: 60),
            "The verified owner's saved dashboard must remain available."
        )
        dashboardCard.tap()

        let card = app.descendants(matching: .any)["native-hype-card"]
        XCTAssertTrue(card.waitForExistence(timeout: 30), "The owner HYPE Card should render.")
        XCTAssertEqual(
            card.value as? String,
            "Photo saved on this iPhone",
            "The owner's photo must come from the private offline snapshot, not a network image."
        )

        let privatePreview = app.descendants(matching: .any)["native-hype-card-private-preview"]
        if visibility == "hidden" {
            XCTAssertTrue(privatePreview.exists, "A hidden card remains available only to its owner.")
        } else {
            XCTAssertFalse(privatePreview.exists, "A public owner card must not be rendered as a private preview.")
        }
    }

    private func exerciseOfflineRestore(visibility: String) throws {
        try requireVisibility(visibility)
        continueAfterFailure = false

        let app = XCUIApplication()
        app.launch()
        openOwnerCard(in: app, visibility: visibility)

        let statsToggle = app.switches["native-hype-card-toggle-stats"]
        XCTAssertTrue(statsToggle.waitForExistence(timeout: 10), "Owner settings must be editable.")
        for _ in 0..<15 where !statsToggle.isHittable { app.swipeUp() }
        XCTAssertTrue(statsToggle.isHittable)
        guard let initialValue = statsToggle.value as? String,
              initialValue == "0" || initialValue == "1" else {
            XCTFail("The stats setting should expose its current switch value.")
            app.terminate()
            return
        }
        statsToggle.tap()
        let localValue = initialValue == "1" ? "0" : "1"
        XCTAssertEqual(statsToggle.value as? String, localValue)
        let localSaveMessage = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == %@ AND label CONTAINS[c] %@",
                        "native-hype-card-settings-message", "saved on this iPhone")
        ).firstMatch
        XCTAssertTrue(
            localSaveMessage.waitForExistence(timeout: 10),
            "The local settings draft should be confirmed before terminating the app."
        )
        app.terminate()

        // The app-level offline switch prevents owner API refreshes while
        // preserving the installed app's real Clerk session and device vault.
        app.launchArguments = ["--ui-testing-force-offline"]
        app.launch()
        openOwnerCard(in: app, visibility: visibility)
        let restoredToggle = app.switches["native-hype-card-toggle-stats"]
        XCTAssertTrue(restoredToggle.waitForExistence(timeout: 10))
        for _ in 0..<15 where !restoredToggle.isHittable { app.swipeUp() }
        XCTAssertEqual(
            restoredToggle.value as? String,
            localValue,
            "An unsynced owner setting must survive app termination and offline relaunch."
        )

        let status = app.descendants(matching: .any)["native-hype-card-offline-status"]
        XCTAssertTrue(status.exists, "The owner view should identify the saved offline card.")

        // The public recipient route must remain read-only even though the
        // same installation now contains this owner's private cached preview.
        app.terminate()
        app.launchArguments = ["--ui-testing-shared-hype-card"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Shared HYPE Card"].waitForExistence(timeout: 15))
        let recipientCard = app.descendants(matching: .any)["native-hype-card"]
        XCTAssertTrue(recipientCard.waitForExistence(timeout: 10))
        XCTAssertNotEqual(
            recipientCard.value as? String,
            "Photo saved on this iPhone",
            "A recipient must not inherit the signed-in owner's cached private photo."
        )
        XCTAssertFalse(app.descendants(matching: .any)["native-hype-card-private-preview"].exists)
        XCTAssertFalse(app.buttons["native-hype-card-toggle-public"].exists)
        XCTAssertFalse(app.buttons["native-hype-card-toggle-stats"].exists)
        app.terminate()
    }

    func testPublicOwnerCardPhotoAndSettingsRestoreOffline() throws {
        try exerciseOfflineRestore(visibility: "public")
    }

    func testHiddenOwnerCardPhotoAndSettingsRestoreOffline() throws {
        try exerciseOfflineRestore(visibility: "hidden")
    }
}
