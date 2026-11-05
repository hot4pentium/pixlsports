import Foundation

@main
struct NativeMomentPlanChecks {
    static func main() throws {
        let full = try NativeMomentPlan(sourceDuration: 60, start: 20, footage: 15)
        precondition(full.start == 20 && full.footage == 15 && full.total == 17)
        let adjustable = try NativeMomentPlan(sourceDuration: 60, start: 20, footage: 15, intro: 3)
        precondition(adjustable.total == 18 && adjustable.footage == 15)
        let short = try NativeMomentPlan(sourceDuration: 0.25, start: 0, footage: 0.25)
        precondition(short.total == 2.25)
        let tail = try NativeMomentPlan(sourceDuration: 19.75, start: 4.75, footage: 15)
        precondition(tail.total == 17)
        for (duration, start, footage) in [
            (20.0, 0.0, 15.01), (20, -1, 10), (20, 15, 10),
            (20, 0, 0), (0, 0, 1), (Double.infinity, 0, 1),
            (20, Double.nan, 1), (20, 0, Double.nan), (20, 20.0005, 0.0001)
        ] {
            do {
                _ = try NativeMomentPlan(sourceDuration: duration, start: start, footage: footage)
                preconditionFailure("Invalid selection accepted")
            } catch is NativeMomentError {}
        }
        precondition(NativeMomentShoutout.allCases.count == 10)
        precondition(Set(NativeMomentShoutout.allCases.map(\.asset)).count == 10)
        print("PASS: footage limit, independent intro, tail selections, invalid ranges, ten unique shoutouts")
    }
}
