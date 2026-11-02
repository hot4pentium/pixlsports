import XCTest
import UIKit

/// Opt-in, real authenticated development account. The DEBUG offline switch
/// denies app API access; it never fabricates a lease or a signed-in identity.
@MainActor
final class NativeOfflineUITests: XCTestCase {
    private func configuredEvent() throws -> String {
        guard let value = ProcessInfo.processInfo.environment["PIXL_OFFLINE_TEST_EVENT_ID"], !value.isEmpty else {
            throw XCTSkip("Set PIXL_OFFLINE_TEST_EVENT_ID to a disposable upcoming event and sign in online first.")
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
        let mode = app.buttons["native-event-mode-statTracker"]
        if mode.waitForExistence(timeout: 5) { mode.tap() }
        let full = app.buttons["native-event-full-tracker"]
        if full.waitForExistence(timeout: 5) { full.tap() }
        element("native-event-start-game", in: app).tap()
        element("native-event-score-team-add", in: app).tap()
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
}
