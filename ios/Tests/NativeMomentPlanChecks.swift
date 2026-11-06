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
        precondition(NativeMomentShoutout.allCases.count == 11)
        precondition(Set(NativeMomentShoutout.allCases.map(\.asset)).count == 10)
        let animated = NativeMomentShoutout.clutchAnimated
        precondition(animated.videoResource == "RecordMomentClutch")
        precondition(animated.fixedIntroSeconds == 2.5)
        let animatedPlan = try NativeMomentPlan(sourceDuration: 60, start: 20, footage: 15,
                                                intro: animated.fixedIntroSeconds!)
        precondition(animatedPlan.total == 17.5 && animatedPlan.footage == 15)
        print("PASS: footage limit, independent intro, invalid ranges, ten poster images, animated Clutch plan")
    }
}
