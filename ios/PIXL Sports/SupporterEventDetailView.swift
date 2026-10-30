import SwiftUI
import ClerkKit

@MainActor
struct SupporterEventDetailView: View {
    @Environment(\.scenePhase) private var scenePhase
    let clerk: Clerk
    let shareToken: String

    @State private var state: DetailState = .loading

    private enum DetailState {
        case loading
        case loaded(schedule: NativeSupporterSchedule, event: AthleteFanEvent)
        case unavailable(String)
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [SupporterHomeColors.background, Color(red: 0.04, green: 0.11, blue: 0.22)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Group {
                switch state {
                case .loading:
                    ProgressView("Verifying Event Card access…")
                        .tint(SupporterHomeColors.accent)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case let .loaded(schedule, event):
                    eventDetails(schedule: schedule, event: event)
                case let .unavailable(message):
                    unavailable(message)
                }
            }
            .frame(maxWidth: 560)
            .padding(.horizontal, 22)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Event Details")
#if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
#endif
        .task {
            await load()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else {
                state = .loading
                return
            }
            Task { await load() }
        }
    }

    @ViewBuilder
    private func eventDetails(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Label(event.type == "practice" ? "PRACTICE" : "EVENT CARD", systemImage: event.type == "practice" ? "figure.run" : "sportscourt.fill")
                        .font(.system(size: 11, weight: .black))
                        .tracking(1.5)
                        .foregroundStyle(SupporterHomeColors.accent)

                    Text(event.title)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)

                    if let athleteName = schedule.athleteName, !athleteName.isEmpty {
                        Text(athleteName)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                }

                VStack(alignment: .leading, spacing: 16) {
                    detailRow(icon: "calendar", label: "DATE", value: event.formattedFullDate(timezone: event.timezone ?? schedule.timezone))
                    detailRow(icon: "clock", label: "TIME", value: event.formattedTime(timezone: event.timezone ?? schedule.timezone))

                    if event.type == "game" {
                        detailRow(
                            icon: "person.2.fill",
                            label: "OPPONENT",
                            value: event.opponent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                ? "Opponent to be announced"
                                : event.opponent
                        )
                    }

                    detailRow(
                        icon: "mappin.and.ellipse",
                        label: "LOCATION",
                        value: event.location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? "Location to be announced"
                            : event.location
                    )

                    if let teamName = schedule.teamName, !teamName.isEmpty {
                        detailRow(icon: "shield.fill", label: "TEAM", value: teamName)
                    }
                    if let seasonName = schedule.seasonName, !seasonName.isEmpty {
                        detailRow(icon: "calendar", label: "SEASON", value: seasonName)
                    }
                    detailRow(
                        icon: event.status == "live" ? "dot.radiowaves.left.and.right" : "checkmark.circle",
                        label: "STATUS",
                        value: event.status == "live" ? "Live" : event.status == "final" ? "Complete" : "Upcoming"
                    )
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
                .overlay {
                    RoundedRectangle(cornerRadius: 22)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func detailRow(icon: String, label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(SupporterHomeColors.accent)
                .frame(width: 20)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 5) {
                Text(label)
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(1.3)
                    .foregroundStyle(SupporterHomeColors.muted)
                Text(value)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func unavailable(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            Image(systemName: "lock.shield")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(SupporterHomeColors.accent)
            Text("Event Card unavailable")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await load() }
            } label: {
                Label("Try again", systemImage: "arrow.clockwise")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(SupporterHomeColors.accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
    }

    private func load() async {
        state = .loading
        do {
            let result = try await SupporterHomeAPI.fetchPrivateEvent(shareToken: shareToken, clerk: clerk)
            guard !Task.isCancelled else { return }
            state = .loaded(schedule: result.schedule, event: result.event)
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            state = .unavailable(error.localizedDescription)
        }
    }
}
