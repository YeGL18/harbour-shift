import XCTest

final class HarbourShiftUITests: XCTestCase {
  private let game = XCUIApplication(bundleIdentifier: "com.ygl100.harbourshift")
  override func setUpWithError() throws {
    continueAfterFailure = false
    game.launch()
    XCTAssertTrue(element("遊戲設定").waitForExistence(timeout: 30))
  }
  override func tearDownWithError() throws { game.terminate() }
  private func element(_ identifier: String) -> XCUIElement {
    game.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }
  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: game.screenshot())
    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
  }
  private func reveal(_ item: XCUIElement) {
    for _ in 0..<8 where !item.isHittable { game.swipeUp() }
    for _ in 0..<8 where !item.isHittable { game.swipeDown() }
  }
  private func configure(_ appearance: String = "淺色") {
    element("遊戲設定").tap()
    XCTAssertTrue(game.buttons[appearance].waitForExistence(timeout: 5))
    game.buttons[appearance].tap(); game.buttons["10×"].tap(); game.buttons["完成"].tap()
  }
  private func start() {
    let fresh = element("start-shift")
    if fresh.exists { fresh.tap() } else { element("new-shift").tap() }
    XCTAssertTrue(element("speed-control").waitForExistence(timeout: 15))
  }
  func testFiveSecondOfferExpiry() throws {
    configure()
    let began = ProcessInfo.processInfo.systemUptime
    start()
    let offer = element("offer-card")
    XCTAssertTrue(offer.exists, "Offer appears with the shift")
    capture("hotfix-five-second-offer-start")
    let expired = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: offer)
    XCTAssertEqual(XCTWaiter.wait(for: [expired], timeout: 5), .completed)
    let elapsed = ProcessInfo.processInfo.systemUptime - began
    XCTAssertGreaterThan(elapsed, 4.7)
    XCTAssertLessThan(elapsed, 7.0, "Includes the native tap/transition and accessibility polling")
    capture("hotfix-five-second-offer-expired")
  }
  func testCompactMapParkingAndOperations() throws {
    configure()
    element("shift-night").tap()
    XCTAssertTrue(element("vehicle-kam-fung").label.contains("晚更車租 HK$370"))
    element("shift-day").tap()
    let handover = element("choose-handover-location")
    reveal(handover); handover.tap()
    XCTAssertTrue(game.navigationBars["交更地點"].waitForExistence(timeout: 5))
    game.navigationBars.buttons.firstMatch.tap()
    start()
    XCTAssertTrue(element("speed-control").isHittable, "Speed remains tappable while offer is displayed")
    element("speed-control").tap(); element("speed-control").tap(); element("speed-control").tap()
    capture("40-compact-offer-and-fixed-speed")
    if element("略過此訂單").exists { element("略過此訂單").tap() }
    element("open-operations").tap()
    XCTAssertTrue(element("accepting-orders-switch").waitForExistence(timeout: 5))
    let accepting = element("accepting-orders-switch")
    if accepting.value as? String == "1" { accepting.tap() }
    capture("41-energy-and-platform-rates")
    let parking = element("temporary-parking"); reveal(parking); parking.tap()
    XCTAssertTrue(game.staticTexts["臨時停車"].waitForExistence(timeout: 5))
    capture("42-parked-on-map")
    element("park-or-drive").tap()
    XCTAssertTrue(game.staticTexts["巡遊中"].waitForExistence(timeout: 5))
    let zoomIn = element("放大地圖")
    let oldZoom = zoomIn.value as? String
    zoomIn.tap()
    let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (zoomIn.value as? String) != oldZoom }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
    element("縮細地圖").tap()
    element("open-order-feed").tap()
    XCTAssertTrue(game.navigationBars["附近單"].waitForExistence(timeout: 5))
    capture("43-nearby-only-feed")
    game.buttons["完成"].tap()
    element("open-operations").tap()
    let handoverButton = element("navigate-handover"); reveal(handoverButton)
    XCTAssertTrue(handoverButton.isHittable)
    let station = game.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "station-")).firstMatch
    reveal(station)
    XCTAssertTrue(station.exists, "Real compatible service stations are listed")
    capture("44-real-service-stations")
    game.buttons["完成"].tap()
  }
  func testExtraLargeMapLayout() throws {
    configure()
    start()
    XCTAssertTrue(element("speed-control").isHittable)
    XCTAssertTrue(element("open-order-feed").isHittable)
    XCTAssertTrue(element("open-operations").isHittable)
    XCTAssertTrue(element("accept-offer").isHittable)
    capture("49-extra-large-map-controls")
    element("open-operations").tap()
    XCTAssertTrue(element("accepting-orders-switch").waitForExistence(timeout: 5))
    capture("50-extra-large-operations")
    game.buttons["完成"].tap()
  }
  func testDrivingOverviewAndSafeCancellation() throws {
    configure("深色")
    guard element("resume-shift").exists else { throw XCTSkip("Seed driving fixture first") }
    element("resume-shift").tap()
    XCTAssertTrue(game.staticTexts["送客途中"].waitForExistence(timeout: 8))
    XCTAssertTrue(element("speed-control").isHittable)
    let overview = game.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "行程全覽")).firstMatch
    XCTAssertTrue(overview.waitForExistence(timeout: 12), "The visible map starts the five-second overview")
    capture("45-trip-route-overview")
    Thread.sleep(forTimeInterval: 5.5)
    let closeCamera = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      (self.element("放大地圖").value as? String)?.contains("14.8") == true
    }, object: nil)
    let cameraResult = XCTWaiter.wait(for: [closeCamera], timeout: 5)
    capture("46-return-to-nearby-view")
    XCTAssertEqual(cameraResult, .completed, "Overview restores original 14.8 zoom; actual: \(self.element("放大地圖").value as? String ?? "missing")")
    element("cancel-order").tap()
    let safeState = game.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "落客", "落車")).firstMatch
    XCTAssertTrue(safeState.waitForExistence(timeout: 2))
    capture("47-safe-cancellation-request")
    let complete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element("cancel-order"))
    XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: 30), .completed)
    capture("48-passenger-alighted")
  }
}
