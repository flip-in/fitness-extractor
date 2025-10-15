//
//  ContentView.swift
//  HealthKit Sync
//
//  Main UI for the app
//

import SwiftUI

struct ContentView: View {
    @StateObject private var syncService = SyncService.shared
    @State private var hasRequestedHealthKitAuth = false
    @State private var showingError = false

    var body: some View {
        NavigationView {
            VStack(spacing: 30) {
                // Header
                VStack(spacing: 10) {
                    Image(systemName: "heart.circle.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.red)

                    Text("HealthKit Sync")
                        .font(.title)
                        .fontWeight(.bold)
                }
                .padding(.top, 40)

                Spacer()

                // Status Section
                VStack(spacing: 15) {
                    if syncService.isSyncing {
                        ProgressView()
                            .scaleEffect(1.5)
                            .padding(.bottom, 10)
                    } else {
                        Image(systemName: syncService.syncError != nil ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                            .font(.system(size: 40))
                            .foregroundColor(syncService.syncError != nil ? .orange : .green)
                    }

                    Text(syncService.syncStatus)
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    if let error = syncService.syncError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 15)
                        .fill(Color.gray.opacity(0.1))
                )
                .padding(.horizontal)

                // Buttons
                VStack(spacing: 15) {
                    Button(action: {
                        Task {
                            await syncService.performFullSync()
                        }
                    }) {
                        HStack {
                            Image(systemName: "arrow.triangle.2.circlepath")
                            Text("Sync Now")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                    }
                    .disabled(syncService.isSyncing)

                    Button(action: {
                        Task {
                            await syncService.performHistoricalImport()
                        }
                    }) {
                        HStack {
                            Image(systemName: "clock.arrow.circlepath")
                            Text("Import Last 90 Days")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.purple)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                    }
                    .disabled(syncService.isSyncing)
                }
                .padding(.horizontal)

                Spacer()

                // Configuration Info
                VStack(spacing: 5) {
                    Text("Backend: \(Config.apiBaseURL)")
                        .font(.caption2)
                        .foregroundColor(.gray)
                    Text("User: \(Config.userId)")
                        .font(.caption2)
                        .foregroundColor(.gray)
                }
                .padding(.bottom, 20)
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .alert("HealthKit Access Required", isPresented: $showingError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text("Please grant HealthKit permissions to use this app.")
            }
            .task {
                // Request HealthKit authorization on first launch
                if !hasRequestedHealthKitAuth {
                    do {
                        try await HealthKitService.shared.requestAuthorization()
                        hasRequestedHealthKitAuth = true
                    } catch {
                        print("HealthKit authorization error: \(error)")
                        showingError = true
                    }
                }
            }
        }
    }
}

#Preview {
    ContentView()
}
