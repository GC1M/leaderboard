import ExpoModulesCore
import SwiftUI
import UIKit

public class LeaderboardDatePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LeaderboardDatePicker")
    AsyncFunction("pick") { (label: String, milliseconds: Double, mode: String, promise: Promise) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("NO_PRESENTER", "Cannot open the date picker right now.")
        return
      }
      let components: DatePickerComponents = mode == "date" ? [.date] : mode == "time" ? [.hourAndMinute] : [.date, .hourAndMinute]
      var controller: UIViewController!
      let view = DatePickerSheet(label: label, date: Date(timeIntervalSince1970: milliseconds / 1000), components: components) { date in
        let presented = controller
        controller = nil
        presented?.dismiss(animated: true) {
          promise.resolve(date.map { $0.timeIntervalSince1970 * 1000 })
        }
      }
      controller = UIHostingController(rootView: view)
      controller.isModalInPresentation = true
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)
  }
}

private struct DatePickerSheet: View {
  let label: String
  @State var date: Date
  let components: DatePickerComponents
  let finish: (Date?) -> Void
  var body: some View {
    NavigationStack {
      Form {
        DatePicker(label, selection: $date, displayedComponents: components)
          .datePickerStyle(.compact)
      }
      .navigationTitle(label)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { finish(nil) } }
        ToolbarItem(placement: .confirmationAction) { Button("Done") { finish(date) } }
      }
    }
  }
}
