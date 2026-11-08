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

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<20 where !element.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable, "The HYPE Card settings control should be reachable.")
    }

    private func replaceText(in field: XCUIElement, with value: String, in app: XCUIApplication) {
        field.tap()
        if let currentValue = field.value as? String,
           currentValue != (field.placeholderValue as? String),
           !currentValue.isEmpty {
            field.press(forDuration: 1)
            let selectAll = app.menuItems["Select All"]
            if selectAll.waitForExistence(timeout: 2) {
                selectAll.tap()
                field.typeText(XCUIKeyboardKey.delete.rawValue)
            } else {
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: currentValue.count))
            }
        }
        if !value.isEmpty {
            field.typeText(value)
        }
        let done = app.keyboards.buttons["Done"]
        if done.waitForExistence(timeout: 2) {
            done.tap()
        } else {
            field.typeText("\n")
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

    func testReopenedCardMergesRemoteOnlyAndSameFieldSettingsChanges() throws {
        try requireVisibility("public")
        continueAfterFailure = false

        let localChoice = "iPhone-\(UUID().uuidString.prefix(8))"
        let remoteChoice = "Remote-\(UUID().uuidString.prefix(8))"
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing-hype-card-settings-conflict",
            "--ui-testing-hype-card-remote-favorite=\(remoteChoice)"
        ]
        app.launch()
        openOwnerCard(in: app, visibility: "public")

        let eventsToggle = app.switches["native-hype-card-toggle-events"]
        XCTAssertTrue(eventsToggle.waitForExistence(timeout: 10))
        reveal(eventsToggle, in: app)
        guard let initialEvents = eventsToggle.value as? String,
              initialEvents == "0" || initialEvents == "1" else {
            XCTFail("The Event Cards setting should expose its current switch value.")
            app.terminate()
            return
        }
        let remoteEvents = initialEvents == "1" ? "0" : "1"

        let favoriteField = app.textFields["native-hype-card-favorite-moment"]
        XCTAssertTrue(favoriteField.waitForExistence(timeout: 10))
        reveal(favoriteField, in: app)
        let originalFavorite = favoriteField.value as? String ?? ""
        replaceText(in: favoriteField, with: localChoice, in: app)
        let localSaveMessage = app.descendants(matching: .any).matching(
            NSPredicate(
                format: "identifier == %@ AND label CONTAINS[c] %@",
                "native-hype-card-settings-message",
                "saved on this iPhone"
            )
        ).firstMatch
        XCTAssertTrue(
            localSaveMessage.waitForExistence(timeout: 10),
            "The same-field iPhone edit must be saved locally before the remote change."
        )

        let remoteChange = app.buttons["native-hype-card-simulate-remote-settings-change"]
        reveal(remoteChange, in: app)
        remoteChange.tap()
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "identifier == %@ AND label CONTAINS[c] %@",
                            "native-hype-card-settings-message", "Other-device settings change applied")
            ).firstMatch.waitForExistence(timeout: 30),
            "The independent authenticated update should change PIXL settings."
        )
        app.terminate()

        // Reopening fetches the newer server revision and rebases the saved
        // iPhone draft against it before presenting the editor.
        app.launchArguments = []
        app.launch()
        openOwnerCard(in: app, visibility: "public")
        let restoredFavorite = app.textFields["native-hype-card-favorite-moment"]
        XCTAssertTrue(restoredFavorite.waitForExistence(timeout: 10))
        reveal(restoredFavorite, in: app)
        XCTAssertEqual(
            restoredFavorite.value as? String,
            localChoice,
            "The conflicting iPhone choice must remain on-device for review."
        )
        let restoredEvents = app.switches["native-hype-card-toggle-events"]
        reveal(restoredEvents, in: app)
        XCTAssertEqual(
            restoredEvents.value as? String,
            remoteEvents,
            "A remote-only setting must merge into the iPhone draft."
        )
        let rebasedMessage = app.descendants(matching: .any).matching(
            NSPredicate(
                format: "identifier == %@ AND label CONTAINS[c] %@",
                "native-hype-card-settings-message",
                "Tap Save to sync them"
            )
        ).firstMatch
        XCTAssertTrue(rebasedMessage.waitForExistence(timeout: 10))

        let saveButton = app.buttons["native-hype-card-save-settings"]
        reveal(saveButton, in: app)
        saveButton.tap()
        let syncedMessage = app.descendants(matching: .any).matching(
            NSPredicate(
                format: "identifier == %@ AND label CONTAINS[c] %@",
                "native-hype-card-settings-message",
                "HYPE Card changes synced"
            )
        ).firstMatch
        XCTAssertTrue(
            syncedMessage.waitForExistence(timeout: 30),
            "Saving the recovered iPhone choice must retain the remote-only field."
        )
        XCTAssertEqual(
            restoredFavorite.value as? String,
            localChoice,
            "The synced same-field winner must remain the iPhone's reviewed choice."
        )
        XCTAssertEqual(
            restoredEvents.value as? String,
            remoteEvents,
            "Saving the local conflict choice must not undo the remote-only setting."
        )

        // Restore the dedicated development owner's starting values so reruns
        // do not accumulate test settings.
        let finalFavorite = app.textFields["native-hype-card-favorite-moment"]
        reveal(finalFavorite, in: app)
        replaceText(in: finalFavorite, with: originalFavorite, in: app)
        if initialEvents != remoteEvents {
            let finalEvents = app.switches["native-hype-card-toggle-events"]
            reveal(finalEvents, in: app)
            finalEvents.tap()
        }
        reveal(saveButton, in: app)
        saveButton.tap()
        let restoreDeadline = Date().addingTimeInterval(30)
        while saveButton.isEnabled && Date() < restoreDeadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTAssertFalse(
            saveButton.isEnabled,
            "The original development settings should be restored and synced."
        )
        app.terminate()
    }

    func testRevokedLinkCannotRestoreHiddenOwnerCardOffline() throws {
        try requireVisibility("hidden")
        continueAfterFailure = false

        let app = XCUIApplication()
        app.launch()
        openOwnerCard(in: app, visibility: "hidden")

        let statsToggle = app.switches["native-hype-card-toggle-stats"]
        XCTAssertTrue(statsToggle.waitForExistence(timeout: 10))
        for _ in 0..<15 where !statsToggle.isHittable { app.swipeUp() }
        guard let initialValue = statsToggle.value as? String,
              initialValue == "0" || initialValue == "1" else {
            XCTFail("The hidden card setting should expose its current switch value.")
            app.terminate()
            return
        }
        statsToggle.tap()
        let localSaveMessage = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == %@ AND label CONTAINS[c] %@",
                        "native-hype-card-settings-message", "saved on this iPhone")
        ).firstMatch
        XCTAssertTrue(
            localSaveMessage.waitForExistence(timeout: 10),
            "The saved settings draft must exist before the link is revoked."
        )

        // This Debug-only route opens the real account-link screen in the same
        // installation. Preserve the local vault to simulate revocation from a
        // different device, then let the app discover it through its API.
        app.terminate()
        app.launchArguments = [
            "--ui-testing-account-link",
            "--ui-testing-preserve-offline-vault"
        ]
        app.launch()
        let disconnect = app.buttons["native-account-link-disconnect"]
        XCTAssertTrue(disconnect.waitForExistence(timeout: 30))
        disconnect.tap()
        let confirmDisconnect = app.buttons["Disconnect"]
        XCTAssertTrue(confirmDisconnect.waitForExistence(timeout: 10))
        confirmDisconnect.tap()
        XCTAssertTrue(
            app.buttons["Connect existing PIXL account"].waitForExistence(timeout: 20),
            "The server should confirm that the account link is revoked."
        )
        app.terminate()

        // The server-side unlink must be discovered by a fresh authenticated
        // schedule request before the old offline data is made inaccessible.
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(
            app.buttons["dashboard-connection-action"].waitForExistence(timeout: 30),
            "The restored iPhone account must require an explicit PIXL reconnection."
        )
        app.terminate()

        // Keep the signed-in iPhone session but disable requests to PIXL. A
        // valid old continuation lease must not reopen the cached owner data.
        app.launchArguments = ["--ui-testing-force-offline"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Connect to get ready"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["dashboard-hype-card"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["native-hype-card"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["native-hype-card-private-preview"].exists)
        XCTAssertFalse(app.switches["native-hype-card-toggle-stats"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["native-hype-card-owner-settings"].exists)
        app.terminate()
    }
}
