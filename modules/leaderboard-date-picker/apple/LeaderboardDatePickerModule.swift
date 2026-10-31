import ExpoModulesCore
import UIKit

public class LeaderboardDatePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LeaderboardDatePicker")
    AsyncFunction("pick") { (label: String, milliseconds: Double, mode: String, promise: Promise) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("NO_PRESENTER", "Cannot open the date picker right now.")
        return
      }
      let picker = DatePickerController(label: label, date: Date(timeIntervalSince1970: milliseconds / 1000), mode: mode) { date in
        promise.resolve(date.map { $0.timeIntervalSince1970 * 1000 })
      }
      let sheet = UINavigationController(rootViewController: picker)
      sheet.modalPresentationStyle = .pageSheet
      sheet.isModalInPresentation = true
      presenter.present(sheet, animated: true)
    }.runOnQueue(.main)
  }
}

private final class DatePickerController: UIViewController {
  private let picker = UIDatePicker()
  private var completion: ((Date?) -> Void)?
  private var finished = false

  init(label: String, date: Date, mode: String, completion: @escaping (Date?) -> Void) {
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
    title = label
    picker.accessibilityLabel = label
    picker.date = date
    picker.datePickerMode = mode == "date" ? .date : mode == "time" ? .time : .dateAndTime
    picker.preferredDatePickerStyle = mode == "date" ? .inline : .wheels
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemGroupedBackground
    navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
    navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
      guard let self else { return }
      self.finish(self.picker.date)
    })
    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    picker.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)
    scroll.addSubview(picker)
    NSLayoutConstraint.activate([
      scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      picker.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16),
      picker.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
      picker.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16),
      picker.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
      picker.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32)
    ])
  }

  private func finish(_ date: Date?) {
    guard !finished else { return }
    finished = true
    let complete = completion
    completion = nil
    dismiss(animated: true) { complete?(date) }
  }
}
