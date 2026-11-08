import XCTest
import UIKit

/// Opt-in, real authenticated development account. The DEBUG offline switch
/// denies app API access; it never fabricates a lease or a signed-in identity.
@MainActor
final class NativeOfflineUITests: XCTestCase {
    private func configuredEvent() throws -> String {
        guard let value = ProcessInfo.processInfo.environment["PIXL_OFFLINE_TEST_EVENT_ID"], !value.isEmpty else {
            throw XCTSkip("Set PIXL_OFFLINE_TEST_EVENT_ID to a fresh disposable upcoming Event Card and sign in online first.")
        }
        continueAfterFailure = false
        return value
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let item = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 20), identifier)
        for _ in 0..<15 where !item.isHittable { app.swipeUp() }
        XCTAssertTrue(item.isHittable, identifier)
        return item
    }

    private func open(_ eventID: String, in app: XCUIApplication) {
        let card = app.buttons.matching(NSPredicate(format: "identifier == %@ OR identifier == %@",
            "dashboard-event-tile-\(eventID)", "dashboard-event-card-\(eventID)")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 30), "The cached dashboard must include the configured event.")
        for _ in 0..<15 where !card.isHittable { app.swipeUp() }
        card.tap()
        XCTAssertTrue(app.buttons["event-card-prep"].waitForExistence(timeout: 20))
    }

    func testOfflineChecklistAndSavedNotesSurviveColdRelaunchAndReconnect() throws {
        let event = try configuredEvent()
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }
        open(event, in: app)
        app.buttons["event-card-prep"].tap()
        _ = element("native-prep-checklist-toggle", in: app)
        // Opening online must have downloaded the authorized base workspace.
        app.terminate()
        app.launchArguments = ["--ui-testing-force-offline"]
        app.launch()
        open(event, in: app)
        app.buttons["event-card-prep"].tap()
        element("native-prep-manage-full", in: app).tap()
        let label = "Offline task " + UUID().uuidString.prefix(8)
        let add = element("native-prep-add-task", in: app)
        add.tap()
        add.typeText(String(label) + "\n")
        let task = app.buttons.matching(NSPredicate(format: "label == %@", String(label))).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        for _ in 0..<15 where !task.isHittable { app.swipeDown() }
        task.tap()
        XCTAssertEqual(task.value as? String, "Ready")
        let note = "Saved without reception " + UUID().uuidString
        let notes = element("native-prep-notes", in: app)
        notes.tap()
        notes.typeText(note)
        for _ in 0..<15 where !app.buttons["native-prep-save"].isHittable { app.swipeDown() }
        app.buttons["native-prep-save"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["native-tool-pending"].waitForExistence(timeout: 10))

        app.terminate()
        app.launch()
        open(event, in: app)
        app.buttons["event-card-prep"].tap()
        element("native-prep-manage-full", in: app).tap()
        XCTAssertTrue(task.waitForExistence(timeout: 15))
        XCTAssertEqual(task.value as? String, "Ready")
        XCTAssertTrue((element("native-prep-notes", in: app).value as? String ?? "").contains(note))
        app.terminate()
        app.launchArguments = []
        app.launch()
        let pending = app.descendants(matching: .any)["native-offline-dashboard-pending"]
        let drained = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: pending)
        XCTAssertEqual(XCTWaiter.wait(for: [drained], timeout: 60), .completed)
        open(event, in: app)
        app.buttons["event-card-prep"].tap()
        element("native-prep-manage-full", in: app).tap()
        XCTAssertTrue(task.waitForExistence(timeout: 15))
        XCTAssertEqual(task.value as? String, "Ready", "Reconnect must not uncheck a custom task.")
    }

    func testTrackerSaveAcknowledgementBecomesSilentOnlyAfterReconnectResponse() throws {
        let event = try configuredEvent()
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        // Fetch the authorized workspace before disconnecting. This must be a
        // disposable upcoming Event Card, since the test starts a game on it.
        open(event, in: app)
        app.buttons["event-card-prep"].tap()
        _ = element("native-prep-checklist-toggle", in: app)
        app.terminate()

        app.launchArguments = ["--ui-testing-force-offline"]
        app.launch()
        open(event, in: app)
        app.buttons["event-card-track-stats"].tap()
        let mode = app.buttons["native-event-choice-statTracker"]
        if mode.waitForExistence(timeout: 5) { mode.tap() }
        let full = app.buttons["native-event-full-tracker"]
        if full.waitForExistence(timeout: 5) { full.tap() }

        let trackerStatus = app.descendants(matching: .any)
            .matching(identifier: "native-event-tracker-save-status").firstMatch
        let trackerRow = app.descendants(matching: .any)
            .matching(identifier: "native-event-tracker-save-status-row").firstMatch
        XCTAssertTrue(trackerStatus.waitForExistence(timeout: 10))
        element("native-event-start-game", in: app).tap()
        element("native-event-score-team-add", in: app).tap()
        let offlineSaved = NSPredicate(format: "value CONTAINS[c] %@", "saved on this iPhone")
        let offlineSavedExpectation = XCTNSPredicateExpectation(predicate: offlineSaved, object: trackerStatus)
        XCTAssertEqual(XCTWaiter.wait(for: [offlineSavedExpectation], timeout: 10), .completed)
        let offlineStatusFrame = trackerRow.frame
        app.terminate()

        // Hold the first online tracker request briefly so the test can
        // observe the pending state before a server response can acknowledge it.
        app.launchArguments = ["--ui-testing-delay-tracker-save"]
        app.launch()
        open(event, in: app)
        app.buttons["event-card-track-stats"].tap()
        if mode.waitForExistence(timeout: 5) { mode.tap() }
        if full.waitForExistence(timeout: 5) { full.tap() }

        XCTAssertTrue(trackerStatus.waitForExistence(timeout: 10))
        let saving = NSPredicate(format: "value CONTAINS[c] %@", "while PIXL confirms them")
        let savingExpectation = XCTNSPredicateExpectation(predicate: saving, object: trackerStatus)
        XCTAssertEqual(XCTWaiter.wait(for: [savingExpectation], timeout: 30), .completed)
        XCTAssertFalse(
            (trackerStatus.value as? String ?? "")
                .localizedCaseInsensitiveContains("Saved to PIXL"),
            "The tracker must not claim server confirmation while its request is pending."
        )
        XCTAssertEqual(trackerRow.frame.minY, offlineStatusFrame.minY, accuracy: 1)
        XCTAssertEqual(trackerRow.frame.height, offlineStatusFrame.height, accuracy: 1)

        let teamScore = app.staticTexts["native-event-score-team-value"]
        let scoreBeforeConfirmation = teamScore.frame
        // The transient notice disappears only once the queue is drained and
        // there is no error, busy request, or offline state. The heading stays.
        let confirmed = NSPredicate(format: "exists == false")
        let confirmedExpectation = XCTNSPredicateExpectation(predicate: confirmed, object: trackerStatus)
        XCTAssertEqual(XCTWaiter.wait(for: [confirmedExpectation], timeout: 60), .completed)
        XCTAssertTrue(trackerRow.exists)
        XCTAssertTrue(app.staticTexts["native-event-tracker-heading"].exists)
        XCTAssertFalse(app.staticTexts["Saved to PIXL"].exists)
        XCTAssertEqual(trackerRow.frame.minY, offlineStatusFrame.minY, accuracy: 1)
        XCTAssertEqual(trackerRow.frame.height, offlineStatusFrame.height, accuracy: 1)
        XCTAssertEqual(teamScore.frame.minY, scoreBeforeConfirmation.minY, accuracy: 1)
    }

    func testFreshGameCanStartScoreAdvanceAndFinishEntirelyOffline() throws {
        let event = try configuredEvent()
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }
        open(event, in: app)
        app.buttons["event-card-prep"].tap()
        _ = element("native-prep-checklist-toggle", in: app)
        app.terminate()
        app.launchArguments = ["--ui-testing-force-offline"]
        app.launch()
        open(event, in: app)
        app.buttons["event-card-track-stats"].tap()
        let mode = app.buttons["native-event-choice-statTracker"]
        if mode.waitForExistence(timeout: 5) { mode.tap() }
        let full = app.buttons["native-event-full-tracker"]
        if full.waitForExistence(timeout: 5) { full.tap() }
        let trackerStatus = app.descendants(matching: .any)
            .matching(identifier: "native-event-tracker-save-status").firstMatch
        let trackerRow = app.descendants(matching: .any)
            .matching(identifier: "native-event-tracker-save-status-row").firstMatch
        XCTAssertTrue(trackerStatus.waitForExistence(timeout: 10))
        let start = element("native-event-start-game", in: app)
        let statusBeforeStart = trackerRow.frame
        start.tap()
        XCTAssertEqual(trackerRow.frame.minY, statusBeforeStart.minY, accuracy: 1)
        XCTAssertEqual(trackerRow.frame.height, statusBeforeStart.height, accuracy: 1)

        let scoreAdd = element("native-event-score-team-add", in: app)
        let teamScore = app.staticTexts["native-event-score-team-value"]
        let statusBeforeScore = trackerRow.frame
        let scoreBeforeTap = teamScore.frame
        XCTAssertTrue((trackerStatus.value as? String ?? "").localizedCaseInsensitiveContains("saved on this iPhone"))
        scoreAdd.tap()
        XCTAssertEqual(trackerRow.frame.minY, statusBeforeScore.minY, accuracy: 1)
        XCTAssertEqual(trackerRow.frame.height, statusBeforeScore.height, accuracy: 1)
        XCTAssertEqual(teamScore.frame.minY, scoreBeforeTap.minY, accuracy: 1)
        element("native-event-score-team-add", in: app).tap()
        element("native-event-score-opponent-add", in: app).tap()
        element("native-event-next-period", in: app).tap()
        element("native-event-end-game", in: app).tap()
        element("native-event-confirm-final", in: app).tap()
        XCTAssertTrue(app.staticTexts["native-event-final-pending"].waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        open(event, in: app)
        app.buttons["event-card-track-stats"].tap()
        if mode.waitForExistence(timeout: 5) { mode.tap() }
        XCTAssertTrue(app.staticTexts["native-event-final-pending"].waitForExistence(timeout: 20))
        // This test deliberately leaves a real provisional final for reconnect
        // verification. Use a fresh disposable event for every run.
    }

    func testStartGameIsCenteredInCompactAndFullTrackerAtBothTextSizes() throws {
        let event = try configuredEvent()
        for accessibilityText in [false, true] {
            assertStartLayout(event, accessibilityText: accessibilityText)
        }
    }

    func testNonSoccerStartIsCenteredWithoutFormatPicker() throws {
        guard let event = ProcessInfo.processInfo.environment["PIXL_OFFLINE_TEST_NON_SOCCER_EVENT_ID"],
              !event.isEmpty else {
            throw XCTSkip("Set PIXL_OFFLINE_TEST_NON_SOCCER_EVENT_ID to a fresh non-soccer Event Card.")
        }
        for accessibilityText in [false, true] {
            assertStartLayout(event, accessibilityText: accessibilityText, expectsFormatPicker: false)
        }
    }

    private func assertStartLayout(_ event: String, accessibilityText: Bool, expectsFormatPicker: Bool? = nil) {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing-share-narrow"]
        if accessibilityText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        app.launch()
        defer { app.terminate() }
        open(event, in: app)
        app.buttons["event-card-track-stats"].tap()
        element("native-event-choice-statTracker", in: app).tap()
        XCTAssertFalse(app.buttons["event-detail-edit-card"].exists)
        assertCenteredStart(in: app, expectsFormatPicker: expectsFormatPicker)
        element("native-event-full-tracker", in: app).tap()
        assertCenteredStart(in: app, expectsFormatPicker: expectsFormatPicker)
    }

    private func assertCenteredStart(in app: XCUIApplication, expectsFormatPicker: Bool?) {
        let start = element("native-event-start-game", in: app)
        let row = app.descendants(matching: .any)["native-event-start-game-row"]
        XCTAssertTrue(row.exists)
        XCTAssertEqual(start.frame.midX, row.frame.midX, accuracy: 1)
        XCTAssertGreaterThanOrEqual(start.frame.height, 44)
        XCTAssertTrue(start.isEnabled)
        XCTAssertFalse(app.staticTexts["Saved to PIXL"].exists)
        let picker = app.segmentedControls["Soccer format"]
        if let expectsFormatPicker { XCTAssertEqual(picker.exists, expectsFormatPicker) }
        if picker.exists { XCTAssertGreaterThanOrEqual(start.frame.minY, picker.frame.maxY) }
    }
}
