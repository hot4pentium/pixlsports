import Foundation

/// Local continuation only, never a bearer credential or permission to publish.
struct NativeOfflineLease: Codable {
    let version: Int
    let issuer: String
    let subject: String
    let origin: String
    var verifiedAt: Date
    var locked: Bool
    let key: Data
    var pendingKeys: [String]? = nil
    var linkId: String? = nil

    func permits(now: Date = Date(), origin: String, subject: String?) -> Bool {
        version == 1 && !locked && linkId != nil && self.origin == origin
            && (subject == nil || subject == self.subject)
            && now >= verifiedAt.addingTimeInterval(-300)
            && now.timeIntervalSince(verifiedAt) <= 7 * 24 * 60 * 60
    }
}
