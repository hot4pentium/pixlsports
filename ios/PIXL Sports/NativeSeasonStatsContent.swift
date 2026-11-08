import SwiftUI
import Charts

struct NativeSeasonStatsContent: View {
    let data: NativeSeasonStats
    @Binding var scope: NativeSeasonStatScope
    @Binding var selectedMetric: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var metrics: [String] { NativeSeasonAnalysis.metrics(data.games, scope: scope) }
    private var metric: String { metrics.contains(selectedMetric) ? selectedMetric : metrics.first ?? "" }
    private var series: [NativeSeasonStatGame] {
        NativeSeasonAnalysis.eligible(data.games, metric: metric, scope: scope)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Picker("Stat attribution", selection: $scope) {
                ForEach(NativeSeasonStatScope.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("season-stats-scope")
            Text(scope == .athlete
                 ? "Athlete stats use athlete-tagged plays only. Games without athlete stats aren’t counted as zero."
                 : "Team totals and scores are separate from your athlete’s personal stats.")
                .font(.footnote)
                .foregroundStyle(SupporterHomeColors.lightMuted)
                .fixedSize(horizontal: false, vertical: true)
            if metrics.isEmpty {
                Text(scope == .athlete
                     ? "No athlete-tagged stats yet. You can still review team results and saved games below."
                     : "No team stats were recorded for these games.")
                    .foregroundStyle(SupporterHomeColors.lightMuted)
                    .accessibilityIdentifier("season-stats-no-metrics")
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    Text("\(scope.rawValue) progress").font(.title2.weight(.bold))
                    Picker("Statistic", selection: Binding(get: { metric }, set: { selectedMetric = $0 })) {
                        ForEach(metrics, id: \.self) { Text(NativeSeasonAnalysis.label($0)).tag($0) }
                    }
                    .pickerStyle(.menu)
                    .tint(SupporterHomeColors.accent)
                    .accessibilityIdentifier("season-stats-metric")
                    summary
                    NativeSeasonStatChart(games: series, metric: metric, scope: scope)
                    comparison
                }
                .seasonStatsPanel()
            }
            Text("Game history · \(data.games.count)")
                .font(.title2.weight(.bold))
                .foregroundStyle(SupporterHomeColors.background)
            ForEach(NativeSeasonAnalysis.sorted(data.games).reversed()) { game in
                NavigationLink {
                    NativeSeasonGameDetail(game: game, teamName: data.teamName)
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(game.opponent.isEmpty ? "Completed game" : "vs \(game.opponent)")
                                .font(.headline)
                            Text(game.dateLabel).font(.subheadline)
                            Text("Team score: \(game.scoreLabel)").font(.caption)
                            if game.pending {
                                Text("Saved on this iPhone · waiting to sync").font(.caption)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right").accessibilityHidden(true)
                    }
                    .seasonStatsPanel()
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("season-stats-game-\(game.id)")
            }
        }
    }

    private var summary: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        let total = series.reduce(0) { $0 + NativeSeasonAnalysis.value($1, metric: metric, scope: scope) }
        return layout {
            figure("Total", value: total.formatted())
            figure("Per game", value: formatted(NativeSeasonAnalysis.average(series, metric: metric, scope: scope)))
            figure("Games with data", value: series.count.formatted())
        }
        .accessibilityIdentifier("season-stats-summary")
    }

    @ViewBuilder
    private var comparison: some View {
        let datedGames = series.filter { $0.parsedDate != nil }
        if let latest = datedGames.last {
            let current = NativeSeasonAnalysis.value(latest, metric: metric, scope: scope)
            let earlier = Array(datedGames.dropLast())
            let average = NativeSeasonAnalysis.average(earlier, metric: metric, scope: scope)
            VStack(alignment: .leading, spacing: 10) {
                Text("Game comparisons").font(.headline)
                Text("Latest game · \(latest.dateLabel): \(current)")
                if let previous = earlier.last {
                    let previousValue = NativeSeasonAnalysis.value(previous, metric: metric, scope: scope)
                    Text("Previous game: \(previousValue) · \(difference(Double(current - previousValue)))")
                } else {
                    Text("Add another completed game to compare results.")
                }
                if let average {
                    Text("Earlier-game average: \(formatted(average)) · \(difference(Double(current) - average))")
                }
                Text("Comparisons use dated games only. Differences are counts, not a rating of performance.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            .font(.subheadline)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("season-stats-comparisons")
        }
    }

    private func figure(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(value).font(.title2.weight(.black)).monospacedDigit()
            Text(title).font(.caption).foregroundStyle(SupporterHomeColors.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func formatted(_ value: Double?) -> String {
        value?.formatted(.number.precision(.fractionLength(0...1))) ?? "—"
    }

    private func difference(_ value: Double) -> String {
        value == 0 ? "no change" : "\(value > 0 ? "+" : "")\(formatted(value))"
    }
}

private struct NativeSeasonStatChart: View {
    let games: [NativeSeasonStatGame]
    let metric: String
    let scope: NativeSeasonStatScope
    private var dated: [NativeSeasonStatGame] { games.filter { $0.parsedDate != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(NativeSeasonAnalysis.label(metric)) by game").font(.headline)
            if !dated.isEmpty {
                Chart(dated) { game in
                    if let date = game.parsedDate {
                        let value = NativeSeasonAnalysis.value(game, metric: metric, scope: scope)
                        LineMark(x: .value("Game date", date), y: .value("Count", value))
                            .interpolationMethod(.linear)
                            .foregroundStyle(Color(red: 97 / 255.0, green: 169 / 255.0, blue: 189 / 255.0))
                        PointMark(x: .value("Game date", date), y: .value("Count", value))
                            .foregroundStyle(Color(red: 140 / 255.0, green: 206 / 255.0, blue: 222 / 255.0))
                            .accessibilityLabel("\(game.dateLabel), \(game.opponent)")
                            .accessibilityValue("\(value) \(NativeSeasonAnalysis.label(metric))")
                    }
                }
                .chartYScale(domain: 0...max(1, (dated.map { NativeSeasonAnalysis.value($0, metric: metric, scope: scope) }.max() ?? 0) + 1))
                .frame(height: 220)
                .accessibilityLabel("\(scope.rawValue) \(NativeSeasonAnalysis.label(metric)) over \(dated.count) dated games")
                .accessibilityIdentifier("season-stats-chart")
            }
            Text("Only completed games are shown. \(games.count - dated.count) games without valid dates are excluded from this graph, but remain in history.")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct NativeSeasonGameDetail: View {
    let game: NativeSeasonStatGame
    let teamName: String

    var body: some View {
        ZStack {
            NativePageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(game.opponent.isEmpty ? "Completed game" : "vs \(game.opponent)")
                        .font(.title.weight(.bold))
                    Text(game.dateLabel)
                    Text("\(teamName.isEmpty ? "Team" : teamName) score: \(game.scoreLabel)")
                    if game.pending { Text("This final is saved on your iPhone and is waiting to sync.") }
                    statSection("Athlete stats", values: game.athleteStats)
                    statSection("Team stats", values: game.stats)
                }
                .padding(22)
                .foregroundStyle(SupporterHomeColors.background)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Game details")
        .accessibilityIdentifier("season-stats-game-detail")
    }

    private func statSection(_ title: String, values: [String: Int]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title2.weight(.bold))
            if values.isEmpty { Text("No stats recorded in this category.").font(.subheadline) }
            ForEach(values.keys.sorted(), id: \.self) { key in
                HStack(alignment: .firstTextBaseline) {
                    Text(NativeSeasonAnalysis.label(key))
                    Spacer(minLength: 12)
                    Text((values[key] ?? 0).formatted()).monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        }
        .seasonStatsPanel()
    }
}

struct NativeSeasonStatsLaunchCard: View {
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "chart.xyaxis.line")
                .font(.title2.weight(.bold))
                .foregroundStyle(SupporterHomeColors.accent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 7) {
                Text("Season Stats").font(.title3.weight(.bold))
                Text("Explore trends, averages, and game-by-game comparisons.")
                    .font(.subheadline).foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "arrow.right").accessibilityHidden(true)
        }
        .seasonStatsPanel()
    }
}

private extension View {
    func seasonStatsPanel() -> some View {
        self.padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(.white)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
            .supporterSurfaceShadow()
    }
}
