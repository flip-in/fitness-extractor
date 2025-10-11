# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an iOS fitness data extraction system with three main components:

1. **iOS App**: Native iOS application that connects to HealthKit to extract fitness data
2. **Database/Backend**: System to store fitness data for external access
3. **Web Dashboard**: Browser-based visualization dashboard for recent activities

## Project Goals

- Extract fitness data from Apple HealthKit on iOS
- Store data in an accessible database
- Provide external system access to fitness data
- Visualize recent activities through a web dashboard

## Current Status

In development - MVP implementation in progress.

## Architecture Decisions

The following technology choices have been made:

- **iOS App**: Swift/SwiftUI with HealthKit framework integration
- **Backend**: Node.js with Express, PostgreSQL database
- **API**: RESTful API with API key authentication
- **Data Sync**: HealthKit Background Delivery with HKObserverQuery
- **Web Dashboard**: React with Vite, Mapbox for GPS visualization
- **Deployment**: Docker Compose on Synology NAS, accessed via Tailscale

See `docs/MVP_ARCHITECTURE.md` for complete architecture plan.

## Roadmap Management

**IMPORTANT:** As you work on this project, you MUST maintain the `ROADMAP.md` file at the root of the repository.

### Rules for Roadmap Updates:

1. **Update after completing each major task or milestone**
2. **Mark phases/tasks as complete when finished**
3. **Add dates when phases are started/completed**
4. **Add notes about blockers, decisions, or changes**
5. **Keep it concise - high-level progress only**
6. **Update it BEFORE committing code changes**

The roadmap provides a quick overview of project progress and current status.

## Development Setup

Build and development commands will be added as each component is implemented.
