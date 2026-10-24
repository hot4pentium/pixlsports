import Foundation

struct AthleteFanPage: Decodable {
    let athleteName: String
    let teamName: String
    let seasonName: String
    let timezone: String?
    let events: [AthleteFanEvent]
}

struct AthleteFanEvent: Decodable, Identifiable {
    let shareToken: String
    let eventId: String
    let title: String
    let date: String
    let time: String
    let type: String
    let status: String
    let opponent: String
    let location: String

    var id: String { shareToken }
}

enum SupporterHomeAPI {
    private static let apiOrigin = URL(string: "https://pixlsports.com")!
    private static let acceptedPageHosts: Set<String> = [
        "pixlsports.com",
        "www.pixlsports.com",
        "league-matrix-creative-studio.replit.app"
    ]

    static func inviteToken(from value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        if let url = URL(string: value), url.scheme != nil, let host = url.host?.lowercased() {
            guard url.scheme?.lowercased() == "https", acceptedPageHosts.contains(host) else {
                return nil
            }
            let parts = url.path.split(separator: "/").map(String.init)
            guard parts.count >= 2,
                  parts[parts.count - 2] == "fan",
                  let token = parts.last,
                  isValidInviteToken(token) else {
                return nil
            }
            return token
        }

        return isValidInviteToken(value) ? value : nil
    }

    static func fetchFanPage(inviteToken: String) async throws -> AthleteFanPage {
        guard isValidInviteToken(inviteToken) else {
            throw SupporterHomeAPIError.invalidPageLink
        }

        let url = apiOrigin
            .appendingPathComponent("api")
            .appendingPathComponent("athlete-invites")
            .appendingPathComponent(inviteToken)
            .appendingPathComponent("fan")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw SupporterHomeAPIError.invalidResponse
        }
        guard response.statusCode == 200 else {
            if response.statusCode == 404 {
                throw SupporterHomeAPIError.pageUnavailable
            }
            throw SupporterHomeAPIError.serviceUnavailable
        }

        do {
            return try JSONDecoder().decode(AthleteFanPage.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    private static func isValidInviteToken(_ token: String) -> Bool {
        guard (24...80).contains(token.count) else { return false }
        return token.unicodeScalars.allSatisfy { scalar in
            CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
                .contains(scalar)
        }
    }
}

enum SupporterHomeAPIError: LocalizedError {
    case invalidPageLink
    case pageUnavailable
    case serviceUnavailable
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidPageLink:
            return "Enter a valid PIXL Sports athlete page link."
        case .pageUnavailable:
            return "That athlete page is unavailable. Check the link or ask for an updated one."
        case .serviceUnavailable:
            return "The PIXL Sports service is having trouble. Please try again shortly."
        case .invalidResponse:
            return "The athlete page returned information we couldn’t read. Please try again."
        }
    }
}
