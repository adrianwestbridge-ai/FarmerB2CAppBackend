const Calendar = require('../models/Calendar');

// Get all events for a specific month
exports.getEventsByMonth = async (req, res) => {
    try {
        const { month } = req.params;
        const events = await Calendar.find({ month: parseInt(month) })
                                     .sort({ day: 1 });
        res.status(200).json(events);
    } catch (error) {
        res.status(500).json({ message: "Error fetching month data", error: error.message });
    }
};

// Get today's event (Auto-detects current date)
exports.getTodayEvent = async (req, res) => {
    try {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentDay = now.getDate();

        const event = await Calendar.findOne({ month: currentMonth, day: currentDay });
        if (!event) return res.status(404).json({ message: "No special event today." ,date:now});

        res.status(200).json(event);
    } catch (error) {
        res.status(500).json({ message: "Error fetching today's event", error: error.message });
    }
};

// Advanced Filter (category, region, public holiday)
exports.searchEvents = async (req, res) => {
    try {
        const { category, region, isPublicHoliday } = req.query;
        let filters = {};

        if (category) filters.category = category;
        if (region) filters.region = region;
        if (isPublicHoliday) filters.isPublicHoliday = isPublicHoliday === 'true';

        const results = await Calendar.find(filters).sort({ month: 1, day: 1 });
        res.status(200).json(results);
    } catch (error) {
        res.status(500).json({ message: "Search failed", error: error.message });
    }
};

// Create new event
exports.addEvent = async (req, res) => {
    try {
        const newEvent = new Calendar(req.body);
        await newEvent.save();
        res.status(201).json({ message: "Event added successfully", data: newEvent });
    } catch (error) {
        res.status(400).json({ message: "Failed to add event", error: error.message });
    }
};