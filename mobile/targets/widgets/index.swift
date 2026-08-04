// WidgetKit extension for the six ConvoReal home-screen widgets.
// The app writes a JSON blob into the shared App Group defaults from
// lib/os-widget-updates.ts — appGroup and storeKey here must match the
// constants there, and summary keys are the WidgetId values from
// lib/home-widgets.ts. Deep links go through app/+native-intent.ts.

import SwiftUI
import WidgetKit

private let appGroup = "group.com.convoreal.app"
private let storeKey = "home-widget-summaries"

struct LinePayload: Codable {
  let title: String
  let detail: String
  let time: String
}

struct SummaryPayload: Codable {
  let value: String
  let sub: String
  let lines: [LinePayload]?
}

struct SummaryStore: Codable {
  let updatedAt: String
  let summaries: [String: SummaryPayload]
}

private func loadStore() -> SummaryStore? {
  guard
    let raw = UserDefaults(suiteName: appGroup)?.string(forKey: storeKey),
    let data = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(SummaryStore.self, from: data)
}

struct SummaryEntry: TimelineEntry {
  let date: Date
  let summary: SummaryPayload?
  let updatedAt: String?
}

struct SummaryProvider: TimelineProvider {
  let id: String
  let placeholderValue: String
  let placeholderSub: String

  func placeholder(in context: Context) -> SummaryEntry {
    SummaryEntry(
      date: Date(),
      summary: SummaryPayload(value: placeholderValue, sub: placeholderSub, lines: nil),
      updatedAt: nil
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
    completion(currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
    completion(
      Timeline(entries: [currentEntry()], policy: .after(Date().addingTimeInterval(30 * 60)))
    )
  }

  private func currentEntry() -> SummaryEntry {
    let store = loadStore()
    return SummaryEntry(date: Date(), summary: store?.summaries[id], updatedAt: store?.updatedAt)
  }
}

struct SummaryWidgetView: View {
  let label: String
  let deepLink: String
  let entry: SummaryEntry

  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetFamily) private var family

  private var accent: Color {
    colorScheme == .dark
      ? Color(red: 0.776, green: 0.965, blue: 0.553)
      : Color(red: 0.027, green: 0.369, blue: 0.329)
  }

  private var background: Color {
    colorScheme == .dark ? Color(red: 0.063, green: 0.129, blue: 0.098) : Color.white
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack {
        Text(label.uppercased())
          .font(.system(size: 11, weight: .bold))
          .foregroundStyle(accent)
        Spacer()
        Text("ConvoReal")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer()
      Text(entry.summary?.value ?? "—")
        .font(.system(size: 28, weight: .heavy))
        .lineLimit(1)
        .minimumScaleFactor(0.5)
      Text(entry.summary?.sub ?? "Open ConvoReal and sign in")
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        .lineLimit(1)
      if family != .systemSmall, let lines = entry.summary?.lines, !lines.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          ForEach(Array(lines.prefix(3).enumerated()), id: \.offset) { _, line in
            HStack(spacing: 6) {
              Text(line.title)
                .font(.system(size: 12, weight: .bold))
                .lineLimit(1)
              Text(line.detail)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
              Text(line.time)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
            }
          }
        }
        .padding(.top, 4)
      }
      Spacer()
      if let updatedAt = entry.updatedAt {
        Text("Updated \(updatedAt)")
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(for: .widget) { background }
    .widgetURL(URL(string: deepLink))
  }
}

struct InboxWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "ConvoRealInbox",
      provider: SummaryProvider(
        id: "inbox", placeholderValue: "3", placeholderSub: "unread · 5 open chats")
    ) { entry in
      SummaryWidgetView(label: "Inbox", deepLink: "convoreal:///", entry: entry)
    }
    .configurationDisplayName("Inbox")
    .description("Unread and open WhatsApp chats")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct CalendarWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "ConvoRealCalendar",
      provider: SummaryProvider(
        id: "calendar", placeholderValue: "2", placeholderSub: "11:30 · Site visit")
    ) { entry in
      SummaryWidgetView(label: "Calendar", deepLink: "convoreal:///calendar", entry: entry)
    }
    .configurationDisplayName("Calendar")
    .description("Today's appointments at a glance")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct ContactsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "ConvoRealContacts",
      provider: SummaryProvider(
        id: "contacts", placeholderValue: "128", placeholderSub: "contacts · 4 hot leads")
    ) { entry in
      SummaryWidgetView(label: "Contacts", deepLink: "convoreal:///contacts", entry: entry)
    }
    .configurationDisplayName("Contacts")
    .description("Your book of leads and hot prospects")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct PropertiesWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "ConvoRealProperties",
      provider: SummaryProvider(
        id: "properties", placeholderValue: "12", placeholderSub: "available · 40 listings")
    ) { entry in
      SummaryWidgetView(label: "Properties", deepLink: "convoreal:///properties", entry: entry)
    }
    .configurationDisplayName("Properties")
    .description("Available listings in your inventory")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct DealsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "ConvoRealDeals",
      provider: SummaryProvider(
        id: "deals", placeholderValue: "₹2.4 Cr", placeholderSub: "6 open deals")
    ) { entry in
      SummaryWidgetView(label: "Deals", deepLink: "convoreal:///deals", entry: entry)
    }
    .configurationDisplayName("Deals")
    .description("Open pipeline value and deal count")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct BroadcastsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "ConvoRealBroadcasts",
      provider: SummaryProvider(
        id: "broadcasts", placeholderValue: "45/50", placeholderSub: "sent · Diwali offers")
    ) { entry in
      SummaryWidgetView(label: "Broadcasts", deepLink: "convoreal:///broadcasts", entry: entry)
    }
    .configurationDisplayName("Broadcasts")
    .description("Delivery of your latest campaign")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct ConvoRealWidgetBundle: WidgetBundle {
  var body: some Widget {
    InboxWidget()
    CalendarWidget()
    ContactsWidget()
    PropertiesWidget()
    DealsWidget()
    BroadcastsWidget()
  }
}
