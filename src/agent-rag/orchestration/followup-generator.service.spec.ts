import { Test, TestingModule } from '@nestjs/testing';
import { FollowupGeneratorService } from './followup-generator.service';
import { GeminiService } from '../../gemini/gemini.service';

describe('FollowupGeneratorService', () => {
  let service: FollowupGeneratorService;
  let mockGemini: { generateContent: jest.Mock };

  beforeEach(async () => {
    mockGemini = {
      generateContent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowupGeneratorService,
        {
          provide: GeminiService,
          useValue: mockGemini,
        },
      ],
    }).compile();

    service = module.get<FollowupGeneratorService>(FollowupGeneratorService);
  });

  it('should parse valid JSON array of 3 follow-up questions', async () => {
    mockGemini.generateContent.mockResolvedValue(
      '["Question 1?", "Question 2?", "Question 3?"]',
    );

    const result = await service.generate('What is auth?', 'Auth works using JWT tokens.');
    expect(result).toEqual(['Question 1?', 'Question 2?', 'Question 3?']);
  });

  it('should handle JSON wrapped in markdown code fence', async () => {
    mockGemini.generateContent.mockResolvedValue(
      '```json\n["Question 1?", "Question 2?", "Question 3?"]\n```',
    );

    const result = await service.generate('What is auth?', 'Auth works using JWT tokens.');
    expect(result).toEqual(['Question 1?', 'Question 2?', 'Question 3?']);
  });

  it('should return empty array on invalid response or JSON parse error', async () => {
    mockGemini.generateContent.mockResolvedValue('Not JSON');

    const result = await service.generate('What is auth?', 'Auth works using JWT tokens.');
    expect(result).toEqual([]);
  });
});
